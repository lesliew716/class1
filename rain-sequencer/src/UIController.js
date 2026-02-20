/**
 * UIController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages all DOM interactions, sequencer grid rendering, score/progression,
 * achievement system, toast notifications, and material unlock logic.
 *
 * This module is intentionally DOM-only — no Three.js dependencies.
 * It communicates with Main.js through a set of callbacks / direct method calls.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { STEPS } from './Sequencer.js';

// ── Unlock thresholds ─────────────────────────────────────────────────────────
const UNLOCKS = [
  { score: 200,  type: 'material', id: 'lotus',   label: 'LOTUS SURFACE',    icon: '🌿' },
  { score: 500,  type: 'material', id: 'stone',   label: 'STONE SURFACE',    icon: '🪨' },
  { score: 800,  type: 'scale',    id: 'major',   label: 'MAJOR SCALE',      icon: '🎵' },
  { score: 1200, type: 'scale',    id: 'blues',   label: 'BLUES SCALE',      icon: '🎸' },
  { score: 1800, type: 'weather',  id: 'drizzle', label: 'DRIZZLE WEATHER',  icon: '🌦' },
  { score: 2500, type: 'weather',  id: 'storm',   label: 'STORM WEATHER',    icon: '⛈' },
];

export class UIController {
  /**
   * @param {object} options
   * @param {function} options.onMaterialSelect  (type: string) => void
   * @param {function} options.onBpmChange       (bpm: number) => void
   * @param {function} options.onRainChange      (intensity: number) => void
   * @param {function} options.onScaleChange     (name: string) => void
   * @param {function} options.onWeatherChange   (name: string) => void
   * @param {function} options.onPlayToggle      () => void
   * @param {function} options.onClear           () => void
   * @param {function} options.onLockPattern     (surface) => void
   * @param {function} options.onDeleteSurface   (surface) => void
   * @param {function} options.onGameStart       () => void
   */
  constructor(options = {}) {
    this._cb = options;

    this._score           = 0;
    this._isPlaying       = false;
    this._selectedSurface = null;
    this._surfaces        = [];    // all active surfaces (for grid rendering)
    this._currentStep     = 0;

    // Grid: Map<surfaceId, HTMLElement[]>  (array of 16 cell divs)
    this._gridRows = new Map();

    this._unlocked = new Set();   // set of unlock IDs already triggered
    this._toastTimer = null;
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  init() {
    this._bindTopBar();
    this._bindPalette();
    this._bindSurfaceInfo();
    this._bindStartOverlay();
    console.log('[UIController] DOM bindings ready');
  }

  // ── Top-bar bindings ────────────────────────────────────────────────────────

  _bindTopBar() {
    const bpmSlider  = document.getElementById('bpm-slider');
    const bpmDisplay = document.getElementById('bpm-display');
    const rainSlider  = document.getElementById('rain-slider');
    const rainDisplay = document.getElementById('rain-display');
    const btnPlay     = document.getElementById('btn-play');
    const btnClear    = document.getElementById('btn-clear');

    bpmSlider.addEventListener('input', () => {
      const v = parseInt(bpmSlider.value, 10);
      bpmDisplay.textContent = v;
      this._cb.onBpmChange?.(v);
    });

    rainSlider.addEventListener('input', () => {
      const v = parseInt(rainSlider.value, 10);
      rainDisplay.textContent = v;
      this._cb.onRainChange?.(v);
    });

    btnPlay.addEventListener('click', () => {
      this._isPlaying = !this._isPlaying;
      btnPlay.textContent = this._isPlaying ? '⏹ STOP' : '▶ START';
      btnPlay.classList.toggle('playing', this._isPlaying);
      this._cb.onPlayToggle?.();
    });

    btnClear.addEventListener('click', () => {
      this._cb.onClear?.();
      this.toast('Patterns cleared');
    });

    document.getElementById('scale-select').addEventListener('change', (e) => {
      this._cb.onScaleChange?.(e.target.value);
      this.toast(`Scale: ${e.target.value}`);
    });

    document.getElementById('weather-select').addEventListener('change', (e) => {
      this._cb.onWeatherChange?.(e.target.value);
      this.toast(`Weather: ${e.target.value}`);
    });
  }

  // ── Palette bindings ────────────────────────────────────────────────────────

  _bindPalette() {
    document.querySelectorAll('.mat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) return;
        const type = btn.dataset.material;
        // Deselect others
        document.querySelectorAll('.mat-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this._cb.onMaterialSelect?.(type);
      });
    });

    // Select first by default
    const first = document.querySelector('.mat-btn:not(.locked)');
    if (first) {
      first.classList.add('selected');
      this._cb.onMaterialSelect?.(first.dataset.material);
    }
  }

  // ── Surface info panel ──────────────────────────────────────────────────────

  _bindSurfaceInfo() {
    document.getElementById('btn-lock-pattern').addEventListener('click', () => {
      if (!this._selectedSurface) return;
      this._cb.onLockPattern?.(this._selectedSurface);
      const btn = document.getElementById('btn-lock-pattern');
      btn.textContent = this._selectedSurface.isLocked ? '🔓 Unlock' : '🔒 Lock Pattern';
      this.toast(this._selectedSurface.isLocked ? 'Pattern locked' : 'Pattern unlocked');
    });

    document.getElementById('btn-delete-surface').addEventListener('click', () => {
      if (!this._selectedSurface) return;
      this._cb.onDeleteSurface?.(this._selectedSurface);
      this.hideInfoPanel();
    });
  }

  _bindStartOverlay() {
    document.getElementById('btn-start-game').addEventListener('click', () => {
      document.getElementById('start-overlay').classList.add('hidden');
      this._cb.onGameStart?.();
    });
  }

  // ── Info panel ──────────────────────────────────────────────────────────────

  showInfoPanel(surface) {
    this._selectedSurface = surface;
    const panel = document.getElementById('surface-info');
    panel.classList.remove('hidden');
    document.getElementById('info-material').textContent = surface.materialType.toUpperCase();
    document.getElementById('info-hit-count').textContent = surface.hitCount;
    document.getElementById('btn-lock-pattern').textContent =
      surface.isLocked ? '🔓 Unlock' : '🔒 Lock Pattern';
  }

  hideInfoPanel() {
    this._selectedSurface = null;
    document.getElementById('surface-info').classList.add('hidden');
  }

  updateInfoPanel() {
    if (!this._selectedSurface) return;
    document.getElementById('info-hit-count').textContent = this._selectedSurface.hitCount;
  }

  // ── Sequencer grid ──────────────────────────────────────────────────────────

  /**
   * Add a row to the sequencer grid for a newly placed surface.
   */
  addSurfaceRow(surface) {
    this._surfaces.push(surface);
    const grid = document.getElementById('seq-grid');

    const row  = document.createElement('div');
    row.className = 'seq-row';
    row.dataset.surfaceId = surface.id;

    const label = document.createElement('div');
    label.className = 'seq-row-label';
    label.textContent = surface.materialType.slice(0, 5).toUpperCase();
    row.appendChild(label);

    const cells = [];
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell';
      // Beat markers every 4 steps
      if (s % 4 === 0) cell.classList.add('beat-mark');
      // Toggle step on click
      cell.addEventListener('click', () => {
        const stepData = surface.pattern[s];
        stepData.active = !stepData.active;
        cell.classList.toggle('active', stepData.active);
      });
      row.appendChild(cell);
      cells.push(cell);
    }

    grid.appendChild(row);
    this._gridRows.set(surface.id, cells);
  }

  /**
   * Remove a surface's row from the grid.
   */
  removeSurfaceRow(surface) {
    const idx = this._surfaces.indexOf(surface);
    if (idx !== -1) this._surfaces.splice(idx, 1);

    const row = document.querySelector(`.seq-row[data-surface-id="${surface.id}"]`);
    if (row) row.remove();
    this._gridRows.delete(surface.id);
  }

  /**
   * Sync all cell states to their surface.pattern[] truth.
   * Call when a pattern changes from outside (e.g. clear).
   */
  syncGrid() {
    for (const surface of this._surfaces) {
      const cells = this._gridRows.get(surface.id);
      if (!cells) continue;
      surface.pattern.forEach((step, i) => {
        cells[i].classList.toggle('active', step.active);
      });
    }
  }

  /**
   * Called by Sequencer.onStep — highlights the current column.
   * @param {number} step  0-15
   */
  onStep(step) {
    // Clear old playing highlight from previous step
    const prev = (step - 1 + STEPS) % STEPS;
    document.querySelectorAll(`.seq-cell:nth-child(${prev + 2})`).forEach(c => {
      c.classList.remove('playing');
    });
    // Add to current step
    document.querySelectorAll(`.seq-cell:nth-child(${step + 2})`).forEach(c => {
      c.classList.add('playing');
    });

    // Update playhead position
    const pct = (step / STEPS) * 100;
    document.getElementById('playhead').style.width = pct + '%';

    this._currentStep = step;

    // Sync active states in case a raindrop just wrote to a step
    this.syncGrid();
  }

  onLoop(loopCount) {
    document.getElementById('loop-count').textContent = loopCount;
    // Score: base + density bonus
    const density = this._calcTotalDensity();
    const gain    = 10 + Math.floor(density * 40);
    this.addScore(gain);
  }

  // ── Flash a surface row in the grid ─────────────────────────────────────────

  flashSurfaceRow(surface) {
    const cells = this._gridRows.get(surface.id);
    if (!cells) return;
    const row = document.querySelector(`.seq-row[data-surface-id="${surface.id}"]`);
    if (!row) return;
    row.style.transition = 'background 0.05s';
    row.style.background = 'rgba(79,195,247,0.15)';
    setTimeout(() => { row.style.background = ''; }, 120);
  }

  // ── Score and progression ────────────────────────────────────────────────────

  addScore(amount) {
    this._score += amount;
    document.getElementById('score-value').textContent = this._score;
    this._checkUnlocks();
  }

  _checkUnlocks() {
    for (const unlock of UNLOCKS) {
      if (this._unlocked.has(unlock.id)) continue;
      if (this._score >= unlock.score) {
        this._unlocked.add(unlock.id);
        this._applyUnlock(unlock);
        this.showAchievement(unlock.icon, unlock.label, `Unlocked at ${unlock.score} points`);
      }
    }
  }

  _applyUnlock(unlock) {
    if (unlock.type === 'material') {
      const btn = document.getElementById(`mat-${unlock.id}`);
      if (btn) {
        btn.classList.remove('locked');
        btn.classList.add('unlocked');
        btn.querySelector('.mat-hint').textContent = '';
      }
    } else if (unlock.type === 'scale') {
      const opt = document.querySelector(`#scale-select option[value="${unlock.id}"]`);
      if (opt) opt.disabled = false;
    } else if (unlock.type === 'weather') {
      const opt = document.querySelector(`#weather-select option[value="${unlock.id}"]`);
      if (opt) opt.disabled = false;
    }
  }

  _calcTotalDensity() {
    // Returns 0-1: ratio of active steps across all surfaces
    let total = 0, active = 0;
    for (const s of this._surfaces) {
      total  += STEPS;
      active += s.activeStepCount;
    }
    return total > 0 ? active / total : 0;
  }

  // ── Notifications ────────────────────────────────────────────────────────────

  toast(message, durationMs = 2000) {
    const el = document.getElementById('toast');
    clearTimeout(this._toastTimer);
    el.textContent = message;
    el.classList.remove('hidden', 'fade');

    this._toastTimer = setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.classList.add('hidden'), 500);
    }, durationMs);
  }

  showAchievement(icon, title, desc) {
    const overlay = document.getElementById('achievement-overlay');
    document.getElementById('achievement-icon').textContent  = icon;
    document.getElementById('achievement-title').textContent = title;
    document.getElementById('achievement-desc').textContent  = desc;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3500);
  }

  // ── Cursor mode ─────────────────────────────────────────────────────────────

  setMode(mode) {
    document.body.className = `mode-${mode}`;
  }
}
