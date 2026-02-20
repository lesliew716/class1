/**
 * Sequencer.js
 * 16-step loop engine using Tone.js Transport + Sequence.
 * Static import ensures a single shared Tone instance across the app.
 */

import * as Tone from 'tone';

export const STEPS = 16;

export class Sequencer {
  /** @param {import('./AudioEngine.js').AudioEngine} audioEngine */
  constructor(audioEngine) {
    this._audio    = audioEngine;
    this._bpm      = 90;
    this._step     = 0;
    this._running  = false;
    this._sequence = null;
    this._surfaces = [];
    this._loopCount = 0;

    /** @type {((step: number) => void) | null} */
    this.onStep = null;
    /** @type {((loopCount: number) => void) | null} */
    this.onLoop = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  init() {
    const transport = Tone.getTransport();
    transport.bpm.value  = this._bpm;
    transport.loop       = true;
    transport.loopStart  = 0;
    transport.loopEnd    = '1m';   // 1 bar of 4/4 = 16 sixteenth notes

    this._sequence = new Tone.Sequence(
      (time, step) => this._onTick(time, step),
      [...Array(STEPS).keys()],
      '16n'
    );
  }

  start() {
    if (this._running) return;
    this._sequence.start(0);
    Tone.getTransport().start();
    this._running = true;
  }

  stop() {
    if (!this._running) return;
    Tone.getTransport().stop();
    this._sequence.stop();
    this._running   = false;
    this._step      = 0;
    this._loopCount = 0;
  }

  // ── BPM ────────────────────────────────────────────────────────────────────

  set bpm(v) {
    this._bpm = v;
    Tone.getTransport().bpm.value = v;
  }
  get bpm() { return this._bpm; }

  get currentStep() { return this._step; }
  get loopCount()   { return this._loopCount; }
  get isRunning()   { return this._running; }

  /** Progress 0-1 within the current bar (for playhead). */
  get barProgress() {
    if (!this._running) return 0;
    const ticks  = Tone.getTransport().ticks;
    const ppq    = Tone.getTransport().PPQ;
    return (ticks % (4 * ppq)) / (4 * ppq);
  }

  // ── Surface registry ────────────────────────────────────────────────────────

  addSurface(surface) {
    if (!this._surfaces.includes(surface)) this._surfaces.push(surface);
  }

  removeSurface(surface) {
    const i = this._surfaces.indexOf(surface);
    if (i !== -1) this._surfaces.splice(i, 1);
  }

  // ── Hit recording ───────────────────────────────────────────────────────────

  /**
   * Called on every raindrop collision.
   * Triggers live audio + writes the quantized step into the surface pattern.
   */
  recordHit(surface, yNorm, velocity) {
    this._audio.trigger(surface.materialType, yNorm, velocity);
    surface.flash();
    surface.hitCount++;

    if (this._running) {
      const step = this._quantizeNow();
      surface.activateStep(step, yNorm, velocity);
    }
  }

  // ── Internal tick ───────────────────────────────────────────────────────────

  _onTick(time, step) {
    this._step = step;

    if (step === 0) {
      this._loopCount++;
      if (this.onLoop) this.onLoop(this._loopCount);
    }

    for (const surface of this._surfaces) {
      const s = surface.pattern[step];
      if (s && s.active) {
        this._audio.triggerAtTime(surface.materialType, s.yNorm, s.velocity, time);
        surface.scheduleFlash(time);
      }
    }

    if (this.onStep) this.onStep(step);
  }

  // ── Quantization ────────────────────────────────────────────────────────────

  /** Round current transport position to the nearest 16th-note step (0-15). */
  _quantizeNow() {
    const ticks   = Tone.getTransport().ticks;
    const ppq     = Tone.getTransport().PPQ;
    const stepLen = ppq / 4;          // ticks per 16th note
    const barLen  = stepLen * STEPS;
    return Math.round((ticks % barLen) / stepLen) % STEPS;
  }

  clearAllPatterns() {
    for (const s of this._surfaces) s.clearPattern();
  }
}
