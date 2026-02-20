/**
 * Sequencer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 16-step loop engine powered by Tone.js Transport.
 *
 * Responsibilities:
 *   • Own the global BPM / Transport.
 *   • Provide quantize(timestamp) → step index (0-15).
 *   • Manage per-surface pattern arrays ([16 booleans]).
 *   • Fire AudioEngine.triggerAtTime() on each active step.
 *   • Emit callbacks: onStep(step), onLoop().
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const STEPS = 16;

export class Sequencer {
  /**
   * @param {AudioEngine} audioEngine
   */
  constructor(audioEngine) {
    this._audio      = audioEngine;
    this._Tone       = null;    // set in init()
    this._bpm        = 90;
    this._step       = 0;       // current transport step (0-15)
    this._running    = false;
    this._sequence   = null;    // Tone.Sequence instance
    this._surfaces   = [];      // array of Surface objects registered here

    // Callbacks
    this.onStep      = null;    // (stepIndex: number) => void
    this.onLoop      = null;    // () => void
    this._loopCount  = 0;

    // Recording window: timestamps of recent impacts (not yet quantized)
    // We flush them at the start of each loop.
    this._pendingHits = [];     // { surfaceId, timestamp, yNorm, velocity }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async init() {
    this._Tone = (await import('https://cdn.jsdelivr.net/npm/tone@15/+esm'));
    const Tone = this._Tone;

    Tone.getTransport().bpm.value = this._bpm;
    Tone.getTransport().loop      = true;
    // One full loop = 16 sixteenth notes = 1 bar of 4/4
    Tone.getTransport().loopStart = 0;
    Tone.getTransport().loopEnd   = '1m';   // 1 measure

    // Create the step sequence — fires every 16th note
    this._sequence = new Tone.Sequence(
      (time, step) => this._onTick(time, step),
      [...Array(STEPS).keys()],   // [0,1,2,...,15]
      '16n'
    );

    console.log('[Sequencer] init done');
  }

  start() {
    if (this._running) return;
    const Tone = this._Tone;
    this._sequence.start(0);
    Tone.getTransport().start();
    this._running = true;
  }

  stop() {
    if (!this._running) return;
    const Tone = this._Tone;
    Tone.getTransport().stop();
    this._sequence.stop();
    this._running  = false;
    this._step     = 0;
    this._loopCount = 0;
  }

  // ── BPM ────────────────────────────────────────────────────────────────────

  set bpm(value) {
    this._bpm = value;
    if (this._Tone) {
      this._Tone.getTransport().bpm.value = value;
    }
  }
  get bpm() { return this._bpm; }

  // ── Current state ───────────────────────────────────────────────────────────

  get currentStep()  { return this._step; }
  get loopCount()    { return this._loopCount; }
  get isRunning()    { return this._running; }

  // Progress 0..1 within the current bar (for playhead rendering)
  get barProgress() {
    if (!this._Tone || !this._running) return 0;
    const ticks  = this._Tone.getTransport().ticks;
    const ppq     = this._Tone.getTransport().PPQ;
    // 1 measure = 4 beats * PPQ ticks
    const barLen  = 4 * ppq;
    return (ticks % barLen) / barLen;
  }

  // ── Surface registration ────────────────────────────────────────────────────

  addSurface(surface) {
    if (!this._surfaces.includes(surface)) {
      this._surfaces.push(surface);
    }
  }

  removeSurface(surface) {
    const idx = this._surfaces.indexOf(surface);
    if (idx !== -1) this._surfaces.splice(idx, 1);
    // Also remove any pending hits from this surface
    this._pendingHits = this._pendingHits.filter(h => h.surfaceId !== surface.id);
  }

  // ── Raindrop hit recording ──────────────────────────────────────────────────

  /**
   * Called immediately when a raindrop collides with a surface.
   * Records the hit for quantization at the next loop boundary,
   * AND triggers an immediate (live) sound.
   *
   * @param {Surface} surface
   * @param {number}  yNorm     0..1, encodes pitch
   * @param {number}  velocity  0..1
   */
  recordHit(surface, yNorm, velocity) {
    // Immediate live audio
    this._audio.trigger(surface.materialType, yNorm, velocity);

    // Flash the surface visually (handled externally via surface.flash())
    surface.flash();
    surface.hitCount++;

    if (this._running) {
      // Quantize to nearest 16th note step
      const step = this._quantizeNow();
      surface.activateStep(step, yNorm, velocity);
    }
  }

  // ── Internal tick ───────────────────────────────────────────────────────────

  _onTick(time, step) {
    this._step = step;

    // Detect loop wrap-around
    if (step === 0 && this._running) {
      this._loopCount++;
      if (this.onLoop) this.onLoop(this._loopCount);
    }

    // Play all active surface steps
    for (const surface of this._surfaces) {
      const stepData = surface.pattern[step];
      if (stepData && stepData.active) {
        this._audio.triggerAtTime(
          surface.materialType,
          stepData.yNorm,
          stepData.velocity,
          time
        );
        // Schedule a visual flash slightly before audio to compensate latency
        surface.scheduleFlash(time);
      }
    }

    if (this.onStep) this.onStep(step);
  }

  // ── Quantization ────────────────────────────────────────────────────────────

  /**
   * Quantizes the current transport position to the nearest 16th-note step.
   * Returns integer 0-15.
   */
  _quantizeNow() {
    if (!this._Tone) return 0;
    const Tone    = this._Tone;
    const ticks   = Tone.getTransport().ticks;
    const ppq     = Tone.getTransport().PPQ;       // ticks per quarter note
    const stepLen = ppq / 4;                       // ticks per 16th note
    const barLen  = stepLen * STEPS;
    const pos     = ticks % barLen;
    // Round to nearest step
    const step = Math.round(pos / stepLen) % STEPS;
    return step;
  }

  /**
   * Quantize an arbitrary audio-context timestamp (seconds) to a step index.
   * Used if you capture timestamps outside of Tone's transport.
   *
   * @param {number} audioTimestamp  - seconds from AudioContext.currentTime
   * @returns {number} step 0-15
   */
  quantizeTimestamp(audioTimestamp) {
    if (!this._Tone) return 0;
    const Tone      = this._Tone;
    const bps       = this._bpm / 60;              // beats per second
    const stepSec   = 1 / (bps * 4);              // seconds per 16th note
    const barSec    = stepSec * STEPS;
    const pos       = audioTimestamp % barSec;
    return Math.round(pos / stepSec) % STEPS;
  }

  // ── Pattern utilities ───────────────────────────────────────────────────────

  clearAllPatterns() {
    for (const s of this._surfaces) s.clearPattern();
  }
}
