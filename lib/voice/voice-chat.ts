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
import { rememberVoice, voiceWasOn } from "./remember";

const log = createLogger("Voice");

export type VoiceStatus = "off" | "requesting" | "on" | "denied" | "unsupported";

/** What the HUD shows. */
export interface VoiceView {
  status: VoiceStatus;
  /** People whose voice is connected. */
  peers: number;
  /** Of those, how many are close enough to hear. */
  inEarshot: number;
  /** People in this place with a microphone on, counting this browser's. */
  withMic: number;
  /** People in this place, counting this browser's. */
  humansHere: number;
  /** People still being connected to. */
  connecting: number;
  /** People the connection could not be made to at all — usually a network that needs a relay. */
  failed: number;
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
    withMic: 0,
    humansHere: 1,
    connecting: 0,
    failed: 0,
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
  /** Connections that failed outright since the microphone came on. */
  private failedPeers = 0;
  /** Whom this browser has said hello to since the microphone came on. */
  private greeted = new Set<string>();
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
          else if (message.type === "welcome") {
            // A new room, or a reconnection: it does not know the microphone
            // is on until told, and nobody in it has been greeted yet.
            if (this.view.status === "on") {
              sendRoom({ type: "mic", on: true });
              this.greeted.clear();
            }
            this.roster();
          } else if (message.type === "presence") this.roster();
        }),
        gameEvents.on("player-moved", (position) => {
          this.me = { x: position.x, y: position.y };
          this.updateVolumes();
        }),
      ];
      // The microphone was on when the last page was left: on again here.
      if (voiceWasOn() && this.view.status === "off") void this.enable();
    }
    return () => {
      this.attached = Math.max(0, this.attached - 1);
      if (this.attached === 0) {
        for (const unsub of this.unsubs) unsub();
        this.unsubs = [];
        // The page is going, not the person's choice: keep it remembered.
        void this.disable({ forget: false });
      }
    };
  }

  async toggle() {
    if (this.view.status === "on" || this.view.status === "requesting") await this.disable();
    else await this.enable();
  }

  /**
   * Switch the microphone on. It is remembered for this tab, so it comes
   * back after walking through a door — unless it is a hold-to-talk press,
   * which lasts only as long as the button.
   */
  async enable({ remember = true }: { remember?: boolean } = {}) {
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
    this.failedPeers = 0;
    this.publish({ status: "on" });
    if (remember) rememberVoice(true);
    log.info("microphone on");
    // The room counts who is on voice; then tell everyone here, and
    // those with a microphone on will answer.
    sendRoom({ type: "mic", on: true });
    this.greeted = new Set(this.humans().map((p) => p.id));
    for (const player of this.humans()) this.send(player.id, { kind: "hello" });
    this.census();
  }

  async disable({ forget = true }: { forget?: boolean } = {}) {
    if (forget) rememberVoice(false);
    if (this.view.status === "off") return;
    for (const player of this.humans()) this.send(player.id, { kind: "bye" });
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.local?.getTracks().forEach((track) => track.stop());
    this.local = null;
    this.localAnalyser = null;
    sendRoom({ type: "mic", on: false });
    this.greeted.clear();
    this.publish({
      status: "off",
      peers: 0,
      inEarshot: 0,
      connecting: 0,
      failed: 0,
      speaking: false,
    });
    this.census();
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
      if (pc.connectionState === "failed") {
        // No route between the two networks: the HUD says so, since the
        // fix — a TURN relay — is not something a person can do mid-chat.
        this.failedPeers += 1;
        log.warn(`voice could not connect to ${id}; a relay (TURN) may be needed`);
        this.drop(id);
      } else if (pc.connectionState === "closed") this.drop(id);
      else if (pc.connectionState === "connected") log.info(`voice connected to ${id}`);
      this.count();
    };
    return peer;
  }

  /** Their voice arrives: play it through a gain we can turn with distance. */
  private hear(id: string, peer: Peer, stream: MediaStream) {
    // The element is what plays: its volume is turned with distance, and it
    // needs no audio context, which a browser may keep suspended. The
    // context only listens, to see when they are talking.
    const sink = new Audio();
    sink.srcObject = stream;
    sink.autoplay = true;
    sink.volume = Math.min(1, Math.max(0, peer.volume));
    void sink.play().catch((err: Error) => log.warn(`could not play ${id}:`, err.message));
    peer.sink = sink;
    if (this.context) {
      if (this.context.state === "suspended") void this.context.resume();
      peer.source = this.context.createMediaStreamSource(stream);
      peer.analyser = this.context.createAnalyser();
      peer.analyser.fftSize = 1024;
      peer.source.connect(peer.analyser);
    }
    this.updateVolumes();
    log.info(`hearing ${id}`);
  }

  private drop(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    if (peer.speaking) gameEvents.emit("voice-speaking", id, false);
    peer.source?.disconnect();
    if (peer.sink) peer.sink.srcObject = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.count();
  }

  /** The roster changed: greet anyone new, forget anyone gone. */
  private roster() {
    this.census();
    if (this.view.status !== "on") return;
    const humans = this.humans();
    const here = new Set(humans.map((p) => p.id));
    for (const id of [...this.peers.keys()]) if (!here.has(id)) this.drop(id);
    // Someone new: say hello, so a person who arrives after the microphone
    // went on is connected to as well.
    for (const player of humans) {
      if (this.greeted.has(player.id)) continue;
      this.greeted.add(player.id);
      this.send(player.id, { kind: "hello" });
    }
    for (const id of [...this.greeted]) if (!here.has(id)) this.greeted.delete(id);
    this.updateVolumes();
  }

  /** How many are here, and how many of them are on voice — this browser included. */
  private census() {
    const humans = this.humans();
    const on = this.view.status === "on";
    const patch = {
      humansHere: humans.length + 1,
      withMic: humans.filter((p) => p.mic).length + (on ? 1 : 0),
    };
    if (patch.humansHere !== this.view.humansHere || patch.withMic !== this.view.withMic) {
      this.publish(patch);
    }
  }

  // ── Distance ───────────────────────────────────────────

  private updateVolumes() {
    if (!this.me) return;
    const players = getPlayers();
    for (const [id, peer] of this.peers) {
      const them = players.find((p) => p.id === id);
      peer.volume = them ? volumeAt(distanceBetween(this.me, them)) : 0;
      if (peer.sink) peer.sink.volume = Math.min(1, Math.max(0, peer.volume));
    }
    this.count();
  }

  private count() {
    const all = [...this.peers.values()];
    const connected = all.filter((p) => p.pc.connectionState === "connected");
    const patch = {
      peers: connected.length,
      inEarshot: connected.filter((p) => p.volume > 0).length,
      connecting: all.filter((p) => ["new", "connecting"].includes(p.pc.connectionState)).length,
      failed: this.failedPeers,
    };
    if (
      patch.peers !== this.view.peers ||
      patch.inEarshot !== this.view.inEarshot ||
      patch.connecting !== this.view.connecting ||
      patch.failed !== this.view.failed
    ) {
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
