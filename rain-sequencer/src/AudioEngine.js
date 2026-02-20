/**
 * AudioEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns all Tone.js synths and reverb/master chain.
 * One synth-factory per material type → distinct timbre.
 * All note choices are constrained to a selected scale to avoid dissonance.
 *
 * Dependencies: Tone.js (loaded via CDN import map in index.html, or importmap)
 *   We dynamically import it so the engine is self-contained.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Scale definitions ────────────────────────────────────────────────────────
// Each scale is a set of semitone offsets from the root (C4 = MIDI 60).
// We'll map surface Y-position → degree within the scale.

export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],   // C D E G A (two octaves)
  major:      [0, 2, 4, 5, 7, 9, 11, 12, 14, 16],
  minor:      [0, 2, 3, 5, 7, 8, 10, 12, 14, 15],
  blues:      [0, 3, 5, 6, 7, 10, 12, 15, 17, 18],
};

const ROOT_MIDI = 60; // C4

// Map a 0-1 float (surface Y) to a MIDI note within the current scale.
function yToNote(yNorm, scaleOffsets) {
  const idx = Math.round(yNorm * (scaleOffsets.length - 1));
  const clamped = Math.max(0, Math.min(scaleOffsets.length - 1, idx));
  return ROOT_MIDI + scaleOffsets[clamped];
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
}

// ── Material synth config ─────────────────────────────────────────────────────
// Each entry is a factory that returns a Tone.js synth + its mixer channel.

const MATERIAL_CONFIGS = {

  metal: {
    color:      0x90a4ae,
    emissive:   0x4fc3f7,
    label:      'METAL',
    pitchRange: [0, 1],         // full pitch range
    createSynth: (Tone) => {
      const synth = new Tone.FMSynth({
        harmonicity:     3.5,
        modulationIndex: 10,
        envelope:        { attack: 0.002, decay: 0.3, sustain: 0,   release: 0.4 },
        modulation:      { type: 'square' },
        modulationEnvelope: { attack: 0.002, decay: 0.1, sustain: 0.2, release: 0.2 },
      });
      return synth;
    },
  },

  glass: {
    color:      0x80deea,
    emissive:   0x00bcd4,
    label:      'GLASS',
    pitchRange: [0.5, 1],       // higher register only
    createSynth: (Tone) => {
      const synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope:   { attack: 0.001, decay: 1.2, sustain: 0,   release: 1.5 },
      });
      return synth;
    },
  },

  wood: {
    color:      0xa1887f,
    emissive:   0x795548,
    label:      'WOOD',
    pitchRange: [0, 0.6],       // mid-low register
    createSynth: (Tone) => {
      const synth = new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves:    4,
        envelope:   { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 },
      });
      return synth;
    },
  },

  lotus: {
    color:      0x81c784,
    emissive:   0x388e3c,
    label:      'LOTUS',
    pitchRange: [0, 0.4],       // low, ambient
    createSynth: (Tone) => {
      const synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope:   { attack: 0.01, decay: 0.8, sustain: 0.1, release: 1.2 },
      });
      return synth;
    },
  },

  stone: {
    color:      0x78909c,
    emissive:   0x546e7a,
    label:      'STONE',
    pitchRange: [0, 0.3],       // very low, percussive
    createSynth: (Tone) => {
      const synth = new Tone.NoiseSynth({
        noise:    { type: 'brown' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
      });
      return synth;
    },
  },
};

// ── AudioEngine class ─────────────────────────────────────────────────────────

export class AudioEngine {
  constructor() {
    this._Tone       = null;      // loaded lazily
    this._synths     = {};        // materialType → Tone.js synth
    this._channels   = {};        // materialType → Tone.Channel
    this._reverb     = null;
    this._master     = null;
    this._scaleName  = 'pentatonic';
    this._scaleOff   = SCALES.pentatonic;
    this._ready      = false;
  }

  // Call once after a user gesture (required by Web Audio policy).
  async init() {
    // Dynamic import – works with both CDN import maps and npm bundles.
    this._Tone = await import('https://cdn.jsdelivr.net/npm/tone@15/+esm');
    const Tone = this._Tone;

    await Tone.start();           // resume AudioContext

    // Master chain: Reverb → Limiter → Destination
    this._reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 }).toDestination();
    await this._reverb.ready;

    this._master = new Tone.Channel({ volume: -6 }).connect(this._reverb);

    // Create one synth + channel per material
    for (const [type, cfg] of Object.entries(MATERIAL_CONFIGS)) {
      const channel = new Tone.Channel({ volume: 0, pan: 0 }).connect(this._master);
      const synth   = cfg.createSynth(Tone);
      synth.connect(channel);

      // Glass gets an extra shimmer filter
      if (type === 'glass') {
        const hiFilter = new Tone.Filter(3000, 'highpass');
        synth.disconnect();
        synth.connect(hiFilter);
        hiFilter.connect(channel);
      }

      // Lotus gets a lowpass filter
      if (type === 'lotus') {
        const loFilter = new Tone.Filter(600, 'lowpass');
        synth.disconnect();
        synth.connect(loFilter);
        loFilter.connect(channel);
      }

      this._synths[type]   = synth;
      this._channels[type] = channel;
    }

    this._ready = true;
    console.log('[AudioEngine] ready');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get isReady() { return this._ready; }

  setScale(name) {
    if (SCALES[name]) {
      this._scaleName = name;
      this._scaleOff  = SCALES[name];
    }
  }

  setChannelVolume(materialType, db) {
    if (this._channels[materialType]) {
      this._channels[materialType].volume.value = db;
    }
  }

  setMasterVolume(db) {
    if (this._master) this._master.volume.value = db;
  }

  setReverbWet(value) {
    if (this._reverb) this._reverb.wet.value = Math.max(0, Math.min(1, value));
  }

  /**
   * Trigger a one-shot impact sound.
   * @param {string} materialType  - e.g. 'metal'
   * @param {number} yNorm         - 0..1, controls pitch within scale
   * @param {number} velocity      - 0..1 (maps to volume offset)
   * @param {number} [time]        - Tone.js time (default: Tone.now())
   */
  trigger(materialType, yNorm, velocity = 0.8, time) {
    if (!this._ready) return;
    const Tone  = this._Tone;
    const synth = this._synths[materialType];
    if (!synth) return;

    const cfg  = MATERIAL_CONFIGS[materialType];
    // Clamp yNorm into this material's pitch range
    const [lo, hi] = cfg.pitchRange;
    const yMapped   = lo + yNorm * (hi - lo);

    const midi  = yToNote(yMapped, this._scaleOff);
    const freq  = midiToFreq(midi);
    const vol   = -30 + velocity * 24;   // -30 dB..−6 dB
    const t     = time ?? Tone.now();

    // Stone uses NoiseSynth (no frequency)
    if (materialType === 'stone') {
      synth.triggerAttackRelease('8n', t);
    } else {
      synth.triggerAttackRelease(freq, '8n', t, velocity);
    }
  }

  /**
   * Trigger from a sequencer step at a precise Tone.js transport time.
   */
  triggerAtTime(materialType, yNorm, velocity, toneTime) {
    this.trigger(materialType, yNorm, velocity, toneTime);
  }

  // Returns the note name for display purposes (e.g. "G4")
  getNoteLabel(materialType, yNorm) {
    const cfg     = MATERIAL_CONFIGS[materialType];
    if (!cfg) return '?';
    const [lo, hi] = cfg.pitchRange;
    const yMapped  = lo + yNorm * (hi - lo);
    const midi     = yToNote(yMapped, this._scaleOff);
    return midiToNoteName(midi);
  }

  // Expose config for rendering
  static getMaterialConfig(type) { return MATERIAL_CONFIGS[type]; }
  static getAllMaterials()       { return Object.keys(MATERIAL_CONFIGS); }
}
