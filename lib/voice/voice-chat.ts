"use client";

/**
 * Proximity voice chat between the people in a room.
 *
 * Audio goes browser to browser over WebRTC; the room socket carries only
 * the handshake, and the server never hears a thing. Everyone with a
 * microphone on is connected to everyone else in the room who has one —
 * a mesh, which is fine for the four people a room holds — and each voice
 * is turned down by how far away its owner stands, from full within a few
 * tiles to nothing past earshot.
 *
 * One instance per browser. It listens to the room socket and the game's
 * events for as long as the HUD is mounted, and does nothing at all until
 * the microphone is switched on.
 */

import { gameEvents } from "../events";
import { createLogger } from "../logger";
import { onRoomMessage, sendRoom } from "../room-socket";
import { getPlayers } from "../presence-roster";
import { getSelfId } from "../presence-self";
import type { PresencePlayer, VoiceSignal } from "../presence-types";
import { distanceBetween, offers, volumeAt } from "./proximity";

const log = createLogger("Voice");

export type VoiceStatus = "off" | "requesting" | "on" | "denied" | "unsupported";

/** What the HUD shows. */
export interface VoiceView {
  status: VoiceStatus;
  /** People whose voice is connected. */
  peers: number;
  /** Of those, how many are close enough to hear. */
  inEarshot: number;
  /** Whether this browser's own microphone is picking up speech. */
  speaking: boolean;
  /** Why the microphone could not be used, when it could not. */
  reason: string | null;
}

/** Voice in the wild: STUN to find a route, and a TURN relay if one is given. */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turn = process.env.NEXT_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/** Louder than this, as RMS of the signal, counts as talking. */
const SPEAKING_RMS = 0.02;
const LEVEL_POLL_MS = 120;

interface Peer {
  pc: RTCPeerConnection;
  /** Keeps Chrome decoding the stream; Web Audio does the actual playing. */
  sink: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
  analyser: AnalyserNode | null;
  /** ICE that arrived before the remote description did. */
  earlyIce: RTCIceCandidateInit[];
  speaking: boolean;
  volume: number;
}

class VoiceChat {
  private view: VoiceView = {
    status: "off",
    peers: 0,
    inEarshot: 0,
    speaking: false,
    reason: null,
  };
  private listeners = new Set<() => void>();
  private local: MediaStream | null = null;
  private context: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private peers = new Map<string, Peer>();
  private me: { x: number; y: number } | null = null;
  private unsubs: (() => void)[] = [];
  private attached = 0;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levels = new Float32Array(1024);

  // ── For the HUD ────────────────────────────────────────

  snapshot(): VoiceView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<VoiceView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ── Lifecycle ──────────────────────────────────────────

  /** Listen to the room while the HUD is mounted. Reference counted. */
  attach(): () => void {
    this.attached += 1;
    if (this.attached === 1) {
      this.unsubs = [
        onRoomMessage((message) => {
          if (message.type === "voice") void this.handle(message.from.id, message.signal);
          else if (message.type === "left") this.drop(message.id);
          else if (message.type === "presence" || message.type === "welcome") this.roster();
        }),
        gameEvents.on("player-moved", (position) => {
          this.me = { x: position.x, y: position.y };
          this.updateVolumes();
        }),
      ];
    }
    return () => {
      this.attached = Math.max(0, this.attached - 1);
      if (this.attached === 0) {
        for (const unsub of this.unsubs) unsub();
        this.unsubs = [];
        void this.disable();
      }
    };
  }

  async toggle() {
    if (this.view.status === "on" || this.view.status === "requesting") await this.disable();
    else await this.enable();
  }

  async enable() {
    if (this.view.status === "on" || this.view.status === "requesting") return;
    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.publish({ status: "unsupported", reason: "This browser cannot do voice chat." });
      return;
    }
    this.publish({ status: "requesting", reason: null });
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = (err as Error)?.name;
      const reason =
        name === "NotAllowedError"
          ? "Microphone access was refused. Allow it in the browser and try again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : `The microphone could not be opened: ${(err as Error)?.message ?? err}`;
      log.warn(reason);
      this.publish({ status: "denied", reason });
      return;
    }
    // A click got us here, so the context may start; if it was made
    // earlier and suspended, wake it.
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    this.localAnalyser = this.context.createAnalyser();
    this.localAnalyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.local).connect(this.localAnalyser);
    this.levelTimer = setInterval(() => this.pollLevels(), LEVEL_POLL_MS);
    this.publish({ status: "on" });
    log.info("microphone on");
    // Tell everyone here; those with a microphone on will answer.
    for (const player of this.humans()) this.send(player.id, { kind: "hello" });
  }

  async disable() {
    if (this.view.status === "off") return;
    for (const player of this.humans()) this.send(player.id, { kind: "bye" });
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.local?.getTracks().forEach((track) => track.stop());
    this.local = null;
    this.localAnalyser = null;
    this.publish({ status: "off", peers: 0, inEarshot: 0, speaking: false });
    log.info("microphone off");
  }

  // ── The handshake ──────────────────────────────────────

  private humans(): PresencePlayer[] {
    const me = getSelfId();
    return getPlayers().filter((p) => !p.resident && p.id !== me);
  }

  private send(to: string, signal: VoiceSignal) {
    sendRoom({ type: "voice", to, signal });
  }

  private async handle(from: string, signal: VoiceSignal) {
    if (this.view.status !== "on") return;
    const me = getSelfId();
    if (!me) return;
    switch (signal.kind) {
      case "hello":
        // They just switched on. Say hello back so they know we are on
        // too, then whichever of us has the lower id opens the line.
        if (!this.peers.has(from)) {
          this.send(from, { kind: "hello" });
          if (offers(me, from)) await this.offerTo(from);
        }
        return;
      case "bye":
        this.drop(from);
        return;
      case "offer": {
        const peer = this.peer(from);
        await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send(from, { kind: "answer", sdp: answer.sdp ?? "" });
        return;
      }
      case "answer": {
        const peer = this.peers.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        await this.flushIce(peer);
        return;
      }
      case "ice": {
        const peer = this.peers.get(from);
        if (!peer) return;
        const candidate = signal.candidate as RTCIceCandidateInit;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate).catch(() => {});
        else peer.earlyIce.push(candidate);
        return;
      }
    }
  }

  private async flushIce(peer: Peer) {
    for (const candidate of peer.earlyIce) await peer.pc.addIceCandidate(candidate).catch(() => {});
    peer.earlyIce = [];
  }

  private async offerTo(id: string) {
    const peer = this.peer(id);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.send(id, { kind: "offer", sdp: offer.sdp ?? "" });
  }

  /** The connection to one person, made on first use. */
  private peer(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer: Peer = {
      pc,
      sink: null,
      source: null,
      gain: null,
      analyser: null,
      earlyIce: [],
      speaking: false,
      volume: 1,
    };
    this.peers.set(id, peer);
    for (const track of this.local?.getTracks() ?? []) pc.addTrack(track, this.local!);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send(id, { kind: "ice", candidate: { ...event.candidate.toJSON() } });
      }
    };
    pc.ontrack = (event) => this.hear(id, peer, event.streams[0] ?? new MediaStream([event.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.drop(id);
      else if (pc.connectionState === "connected") log.info(`voice connected to ${id}`);
      this.count();
    };
    return peer;
  }

  /** Their voice arrives: play it through a gain we can turn with distance. */
  private hear(id: string, peer: Peer, stream: MediaStream) {
    if (!this.context) return;
    const sink = new Audio();
    sink.srcObject = stream;
    sink.muted = true;
    void sink.play().catch(() => {});
    peer.sink = sink;
    peer.source = this.context.createMediaStreamSource(stream);
    peer.gain = this.context.createGain();
    peer.analyser = this.context.createAnalyser();
    peer.analyser.fftSize = 1024;
    peer.source.connect(peer.analyser);
    peer.analyser.connect(peer.gain);
    peer.gain.connect(this.context.destination);
    this.updateVolumes();
    log.info(`hearing ${id}`);
  }

  private drop(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    if (peer.speaking) gameEvents.emit("voice-speaking", id, false);
    peer.source?.disconnect();
    peer.gain?.disconnect();
    if (peer.sink) peer.sink.srcObject = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.count();
  }

  /** The roster changed: greet anyone new, forget anyone gone. */
  private roster() {
    if (this.view.status !== "on") return;
    const here = new Set(this.humans().map((p) => p.id));
    for (const id of [...this.peers.keys()]) if (!here.has(id)) this.drop(id);
    this.updateVolumes();
  }

  // ── Distance ───────────────────────────────────────────

  private updateVolumes() {
    if (!this.me || !this.context) return;
    const players = getPlayers();
    for (const [id, peer] of this.peers) {
      const them = players.find((p) => p.id === id);
      peer.volume = them ? volumeAt(distanceBetween(this.me, them)) : 0;
      peer.gain?.gain.setTargetAtTime(peer.volume, this.context.currentTime, 0.08);
    }
    this.count();
  }

  private count() {
    const connected = [...this.peers.values()].filter((p) => p.pc.connectionState === "connected");
    const patch = {
      peers: connected.length,
      inEarshot: connected.filter((p) => p.volume > 0).length,
    };
    if (patch.peers !== this.view.peers || patch.inEarshot !== this.view.inEarshot) {
      this.publish(patch);
    }
  }

  // ── Who is talking ─────────────────────────────────────

  private loudness(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.levels);
    let sum = 0;
    for (let i = 0; i < analyser.fftSize; i++) sum += this.levels[i] * this.levels[i];
    return Math.sqrt(sum / analyser.fftSize);
  }

  private pollLevels() {
    if (this.localAnalyser) {
      const speaking = this.loudness(this.localAnalyser) > SPEAKING_RMS;
      if (speaking !== this.view.speaking) this.publish({ speaking });
    }
    for (const [id, peer] of this.peers) {
      if (!peer.analyser) continue;
      const speaking = peer.volume > 0 && this.loudness(peer.analyser) > SPEAKING_RMS;
      if (speaking !== peer.speaking) {
        peer.speaking = speaking;
        gameEvents.emit("voice-speaking", id, speaking);
      }
    }
  }
}

export const voiceChat = new VoiceChat();
