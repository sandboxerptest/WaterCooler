"use client";

/**
 * Sound effects for the cabinet, made rather than loaded: a few oscillators
 * and a little noise, shaped by name. The games never touch audio; they
 * leave the name of a sound in their state, and the cabinet plays it.
 * Independent of the music and its mute.
 */

export type SoundName =
  | "blip"
  | "select"
  | "flap"
  | "score"
  | "eat"
  | "bounce"
  | "brick"
  | "power"
  | "lose"
  | "die"
  | "win"
  | "card"
  | "place"
  | "foundation"
  | "shuffle"
  | "thud"
  | "swing"
  | "hit"
  | "hurt"
  | "dig"
  | "pickup"
  | "chime"
  | "step";

let context: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

/** A tone that slides from one pitch to another and fades. */
function tone(
  from: number,
  to: number,
  seconds: number,
  type: OscillatorType = "square",
  volume = 0.12,
  delay = 0,
) {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const at = c.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + seconds);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** A burst of noise, for thuds, scrapes and swings. */
function noise(seconds: number, volume = 0.1, delay = 0, lowpass = 1200) {
  const c = ctx();
  if (!c) return;
  const frames = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const source = c.createBufferSource();
  source.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const gain = c.createGain();
  gain.gain.value = volume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  source.start(c.currentTime + delay);
}

const SOUNDS: Record<SoundName, () => void> = {
  blip: () => tone(660, 660, 0.05),
  select: () => tone(440, 880, 0.08),
  flap: () => tone(300, 600, 0.08, "triangle", 0.15),
  score: () => {
    tone(880, 880, 0.06, "square", 0.1);
    tone(1320, 1320, 0.1, "square", 0.1, 0.07);
  },
  eat: () => tone(500, 900, 0.07, "square", 0.12),
  bounce: () => tone(400, 400, 0.04, "square", 0.08),
  brick: () => tone(700, 1100, 0.05, "square", 0.1),
  power: () => {
    tone(600, 900, 0.08, "triangle", 0.12);
    tone(900, 1400, 0.12, "triangle", 0.12, 0.08);
  },
  lose: () => tone(400, 100, 0.35, "sawtooth", 0.1),
  die: () => {
    tone(300, 60, 0.5, "sawtooth", 0.12);
    noise(0.3, 0.08, 0, 800);
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.14, "square", 0.1, i * 0.12));
  },
  card: () => noise(0.04, 0.12, 0, 3000),
  place: () => noise(0.06, 0.15, 0, 1500),
  foundation: () => {
    tone(784, 784, 0.07, "triangle", 0.12);
    tone(1046, 1046, 0.12, "triangle", 0.12, 0.08);
  },
  shuffle: () => {
    for (let i = 0; i < 6; i++) noise(0.03, 0.08, i * 0.04, 3000);
  },
  thud: () => tone(160, 90, 0.12, "triangle", 0.12),
  swing: () => noise(0.12, 0.09, 0, 2500),
  hit: () => {
    noise(0.08, 0.14, 0, 900);
    tone(220, 110, 0.1, "square", 0.08);
  },
  hurt: () => tone(200, 80, 0.25, "sawtooth", 0.12),
  dig: () => {
    noise(0.1, 0.12, 0, 600);
    noise(0.1, 0.12, 0.12, 600);
  },
  pickup: () => {
    [659, 784, 1046].forEach((f, i) => tone(f, f, 0.1, "square", 0.1, i * 0.09));
  },
  chime: () => {
    [523, 784, 1046, 1568].forEach((f, i) => tone(f, f, 0.2, "sine", 0.12, i * 0.15));
  },
  step: () => tone(520, 520, 0.03, "square", 0.05),
};

export function playSound(name: string) {
  const sound = SOUNDS[name as SoundName];
  if (sound) sound();
}

/** Play and clear whatever a game left in its queue. */
export function drainSounds(queue: unknown) {
  if (!Array.isArray(queue)) return;
  for (const name of queue.splice(0)) playSound(String(name));
}
