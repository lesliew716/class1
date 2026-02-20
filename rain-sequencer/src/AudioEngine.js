/**
 * AudioEngine.js
 * One Tone.js synth per material type, all constrained to a selected scale.
 * Uses a static import (resolved by the import map in index.html).
 */

import * as Tone from 'tone';

// ── Scale definitions ─────────────────────────────────────────────────────────
// Semitone offsets from C4 (MIDI 60), two octaves worth of each scale.
export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  major:      [0, 2, 4, 5, 7, 9, 11, 12, 14, 16],
  minor:      [0, 2, 3, 5, 7, 8, 10, 12, 14, 15],
  blues:      [0, 3, 5, 6, 7, 10, 12, 15, 17, 18],
};

const ROOT_MIDI = 60; // C4

function yToMidi(yNorm, scaleOffsets) {
  const idx = Math.round(yNorm * (scaleOffsets.length - 1));
  const clamped = Math.max(0, Math.min(scaleOffsets.length - 1, idx));
  return ROOT_MIDI + scaleOffsets[clamped];
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

// ── Per-material config ───────────────────────────────────────────────────────
const CONFIGS = {
  metal: {
    color: 0x90a4ae, emissive: 0x4fc3f7, label: 'METAL',
    pitchRange: [0, 1],
    makeSynth() {
      return new Tone.FMSynth({
        harmonicity: 3.5, modulationIndex: 10,
        envelope:            { attack: 0.002, decay: 0.3,  sustain: 0,   release: 0.4 },
        modulationEnvelope:  { attack: 0.002, decay: 0.1,  sustain: 0.2, release: 0.2 },
        modulation: { type: 'square' },
      });
    },
  },
  glass: {
    color: 0x80deea, emissive: 0x00bcd4, label: 'GLASS',
    pitchRange: [0.5, 1],
    makeSynth() {
      return new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.5 },
      });
    },
  },
  wood: {
    color: 0xa1887f, emissive: 0x795548, label: 'WOOD',
    pitchRange: [0, 0.6],
    makeSynth() {
      return new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 4,
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 },
      });
    },
  },
  lotus: {
    color: 0x81c784, emissive: 0x388e3c, label: 'LOTUS',
    pitchRange: [0, 0.4],
    makeSynth() {
      return new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.8, sustain: 0.1, release: 1.2 },
      });
    },
  },
  stone: {
    color: 0x78909c, emissive: 0x546e7a, label: 'STONE',
    pitchRange: [0, 0.3],
    makeSynth() {
      return new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
      });
    },
  },
};

// ── AudioEngine ───────────────────────────────────────────────────────────────
export class AudioEngine {
  constructor() {
    this._synths    = {};
    this._channels  = {};
    this._reverb    = null;
    this._master    = null;
    this._scaleOff  = SCALES.pentatonic;
    this._ready     = false;
  }

  /** Call once after a user gesture (Web Audio policy). */
  async init() {
    await Tone.start();

    this._reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 }).toDestination();
    await this._reverb.ready;

    this._master = new Tone.Channel({ volume: -6 }).connect(this._reverb);

    for (const [type, cfg] of Object.entries(CONFIGS)) {
      const channel = new Tone.Channel({ volume: 0 }).connect(this._master);
      const synth   = cfg.makeSynth();

      if (type === 'glass') {
        const hi = new Tone.Filter(2800, 'highpass');
        synth.connect(hi);
        hi.connect(channel);
      } else if (type === 'lotus') {
        const lo = new Tone.Filter(600, 'lowpass');
        synth.connect(lo);
        lo.connect(channel);
      } else {
        synth.connect(channel);
      }

      this._synths[type]   = synth;
      this._channels[type] = channel;
    }

    this._ready = true;
    console.log('[AudioEngine] ready');
  }

  get isReady() { return this._ready; }

  setScale(name) {
    if (SCALES[name]) this._scaleOff = SCALES[name];
  }

  /**
   * Trigger a sound immediately (live hit).
   * @param {string} type     materialType
   * @param {number} yNorm    0-1 → pitch
   * @param {number} velocity 0-1
   * @param {number} [time]   Tone audio time (optional; defaults to now)
   */
  trigger(type, yNorm, velocity = 0.8, time) {
    if (!this._ready) return;
    const synth = this._synths[type];
    if (!synth) return;

    const cfg      = CONFIGS[type];
    const [lo, hi] = cfg.pitchRange;
    const mapped   = lo + yNorm * (hi - lo);
    const freq     = midiToFreq(yToMidi(mapped, this._scaleOff));
    const t        = time ?? Tone.now();

    if (type === 'stone') {
      synth.triggerAttackRelease('8n', t);
    } else {
      synth.triggerAttackRelease(freq, '8n', t, velocity);
    }
  }

  /** Alias used by the Sequencer for scheduled playback. */
  triggerAtTime(type, yNorm, velocity, toneTime) {
    this.trigger(type, yNorm, velocity, toneTime);
  }

  getNoteLabel(type, yNorm) {
    const cfg = CONFIGS[type];
    if (!cfg) return '?';
    const [lo, hi] = cfg.pitchRange;
    return midiToName(yToMidi(lo + yNorm * (hi - lo), this._scaleOff));
  }

  static getMaterialConfig(type) { return CONFIGS[type]; }
  static getAllMaterials()       { return Object.keys(CONFIGS); }
}
