/**
 * Surface.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Represents a placed material surface in the 3D scene.
 *
 * Each surface owns:
 *   • A Three.js Mesh (visual)
 *   • A bounding box / AABB collider
 *   • A 16-step pattern array
 *   • State: selected, locked, hitCount
 *
 * The Surface does NOT import Three.js directly — it receives the THREE
 * namespace via constructor to stay decoupled from the module graph.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { STEPS } from './Sequencer.js';
import { AudioEngine } from './AudioEngine.js';

let _nextId = 1;

/**
 * @typedef {Object} StepData
 * @property {boolean} active
 * @property {number}  yNorm     0-1
 * @property {number}  velocity  0-1
 */

export class Surface {
  /**
   * @param {object} THREE          - Three.js namespace
   * @param {string} materialType   - 'metal' | 'glass' | 'wood' | 'lotus' | 'stone'
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} [size]  - default (3, 0.1, 2)
   */
  constructor(THREE, materialType, position, size) {
    this.id           = _nextId++;
    this.materialType = materialType;
    this.hitCount     = 0;
    this.isSelected   = false;
    this.isLocked     = false;   // when locked, pattern no longer records new hits

    /** @type {StepData[]} */
    this.pattern = Array.from({ length: STEPS }, () => ({
      active:   false,
      yNorm:    0.5,
      velocity: 0.8,
    }));

    this._THREE = THREE;
    this._size  = size ?? new THREE.Vector3(3, 0.08, 2);
    this._mesh  = this._buildMesh(position);
    this._flashTimer = 0;
    this._scheduleFlashFn = null;  // set externally for Tone-scheduled flashes
  }

  // ── Mesh ────────────────────────────────────────────────────────────────────

  _buildMesh(position) {
    const THREE = this._THREE;
    const cfg   = AudioEngine.getMaterialConfig(this.materialType);

    const geo  = new THREE.BoxGeometry(this._size.x, this._size.y, this._size.z);
    const mat  = new THREE.MeshStandardMaterial({
      color:         cfg.color,
      emissive:      cfg.emissive,
      emissiveIntensity: 0.08,
      roughness:     this._roughnessFor(this.materialType),
      metalness:     this._metalnessFor(this.materialType),
      transparent:   this.materialType === 'glass',
      opacity:       this.materialType === 'glass' ? 0.55 : 1.0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.surfaceId = this.id;

    // Selection outline: a slightly larger wireframe
    const outlineGeo = new THREE.BoxGeometry(
      this._size.x + 0.05, this._size.y + 0.05, this._size.z + 0.05
    );
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7, wireframe: true, visible: false,
    });
    this._outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
    mesh.add(this._outlineMesh);

    return mesh;
  }

  _roughnessFor(type) {
    return { metal: 0.2, glass: 0.0, wood: 0.9, lotus: 0.8, stone: 0.95 }[type] ?? 0.5;
  }
  _metalnessFor(type) {
    return { metal: 0.8, glass: 0.1, wood: 0.0, lotus: 0.0, stone: 0.0 }[type] ?? 0.1;
  }

  get mesh() { return this._mesh; }

  get position() { return this._mesh.position; }

  // ── AABB Collider ───────────────────────────────────────────────────────────

  /**
   * Returns the world-space AABB of this surface.
   * @returns {{ min: THREE.Vector3, max: THREE.Vector3 }}
   */
  getBounds() {
    const p  = this._mesh.position;
    const hs = this._size.clone().multiplyScalar(0.5);
    return {
      min: p.clone().sub(hs),
      max: p.clone().add(hs),
    };
  }

  /**
   * Fast point-AABB test (XZ only; Y is the surface plane).
   * Raindrop hits are checked at the drop's current position.
   */
  containsPoint(px, pz) {
    const bounds = this.getBounds();
    return (
      px >= bounds.min.x && px <= bounds.max.x &&
      pz >= bounds.min.z && pz <= bounds.max.z
    );
  }

  /**
   * Maps a hit X position to a normalised pitch value (0-1).
   * Left edge → 0, right edge → 1.
   */
  xToYNorm(px) {
    const bounds = this.getBounds();
    return Math.max(0, Math.min(1, (px - bounds.min.x) / (bounds.max.x - bounds.min.x)));
  }

  // ── Pattern ─────────────────────────────────────────────────────────────────

  /**
   * Activate a sequencer step with pitch/velocity data.
   * If the surface is locked, ignores the write.
   */
  activateStep(stepIndex, yNorm, velocity) {
    if (this.isLocked) return;
    const step     = this.pattern[stepIndex];
    step.active    = true;
    step.yNorm     = yNorm;
    step.velocity  = velocity;
  }

  deactivateStep(stepIndex) {
    this.pattern[stepIndex].active = false;
  }

  clearPattern() {
    this.pattern.forEach(s => { s.active = false; });
  }

  lockPattern() {
    this.isLocked = true;
  }

  unlockPattern() {
    this.isLocked = false;
  }

  get activeStepCount() {
    return this.pattern.filter(s => s.active).length;
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  select() {
    this.isSelected = true;
    this._outlineMesh.material.visible = true;
  }

  deselect() {
    this.isSelected = false;
    this._outlineMesh.material.visible = false;
  }

  // ── Hit Flash ───────────────────────────────────────────────────────────────

  /**
   * Immediate (non-scheduled) flash — used for live raindrop hits.
   */
  flash() {
    const mat = this._mesh.material;
    mat.emissiveIntensity = 1.5;
    this._flashTimer = 120;   // ms
  }

  /**
   * Called from Sequencer._onTick to schedule a visual flash aligned to audio.
   * We attach a custom callback so UIController can handle DOM-side flash too.
   */
  scheduleFlash(toneTime) {
    if (this._scheduleFlashFn) this._scheduleFlashFn(this, toneTime);
    else this.flash();
  }

  /**
   * Call every animation frame with delta in ms.
   * Decays the emissive flash back to baseline.
   */
  update(deltaMs) {
    if (this._flashTimer > 0) {
      this._flashTimer = Math.max(0, this._flashTimer - deltaMs);
      const mat = this._mesh.material;
      const t   = this._flashTimer / 120;
      mat.emissiveIntensity = 0.08 + t * 1.42;
    }
  }

  // ── Serialization ───────────────────────────────────────────────────────────

  toJSON() {
    return {
      id:           this.id,
      materialType: this.materialType,
      position:     this._mesh.position.toArray(),
      pattern:      this.pattern.map(s => ({
        active: s.active, yNorm: s.yNorm, velocity: s.velocity,
      })),
      isLocked: this.isLocked,
      hitCount: this.hitCount,
    };
  }
}
