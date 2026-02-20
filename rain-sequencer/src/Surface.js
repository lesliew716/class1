/**
 * Surface.js
 * A placed material surface: Three.js mesh + AABB collider + 16-step pattern.
 * Does not import Three.js directly — receives the THREE namespace via constructor.
 */

import { STEPS }       from './Sequencer.js';
import { AudioEngine } from './AudioEngine.js';

let _nextId = 1;

export class Surface {
  /**
   * @param {object}          THREE
   * @param {string}          materialType  'metal'|'glass'|'wood'|'lotus'|'stone'
   * @param {THREE.Vector3}   position
   * @param {THREE.Vector3}  [size]         default (3, 0.08, 2)
   */
  constructor(THREE, materialType, position, size) {
    this.id           = _nextId++;
    this.materialType = materialType;
    this.hitCount     = 0;
    this.isSelected   = false;
    this.isLocked     = false;

    /** @type {Array<{active:boolean, yNorm:number, velocity:number}>} */
    this.pattern = Array.from({ length: STEPS }, () => ({
      active: false, yNorm: 0.5, velocity: 0.8,
    }));

    this._THREE = THREE;
    this._size  = size ?? new THREE.Vector3(3, 0.08, 2);
    this._mesh  = this._buildMesh(position);
    this._flashTimer = 0;

    /** Optionally set by Main.js to sync visual flash timing with Tone scheduling. */
    this._scheduleFlashFn = null;
  }

  // ── Mesh ────────────────────────────────────────────────────────────────────
  _buildMesh(position) {
    const THREE = this._THREE;
    const cfg   = AudioEngine.getMaterialConfig(this.materialType);

    const roughness = { metal: 0.2, glass: 0.0, wood: 0.9, lotus: 0.8, stone: 0.95 }[this.materialType] ?? 0.5;
    const metalness = { metal: 0.8, glass: 0.1, wood: 0.0, lotus: 0.0, stone: 0.0 }[this.materialType] ?? 0.1;

    const mat = new THREE.MeshStandardMaterial({
      color:    cfg.color,
      emissive: cfg.emissive,
      emissiveIntensity: 0.08,
      roughness, metalness,
      transparent: this.materialType === 'glass',
      opacity:     this.materialType === 'glass' ? 0.55 : 1.0,
    });

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(this._size.x, this._size.y, this._size.z), mat);
    mesh.position.copy(position);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.surfaceId = this.id;

    // Cyan wireframe outline (shown when selected)
    this._outline = new THREE.Mesh(
      new THREE.BoxGeometry(this._size.x + 0.06, this._size.y + 0.06, this._size.z + 0.06),
      new THREE.MeshBasicMaterial({ color: 0x4fc3f7, wireframe: true, visible: false })
    );
    mesh.add(this._outline);
    return mesh;
  }

  get mesh()     { return this._mesh; }
  get position() { return this._mesh.position; }

  // ── AABB Collider ────────────────────────────────────────────────────────────
  getBounds() {
    const p  = this._mesh.position;
    const hs = this._size.clone().multiplyScalar(0.5);
    return { min: p.clone().sub(hs), max: p.clone().add(hs) };
  }

  containsPoint(px, pz) {
    const { min, max } = this.getBounds();
    return px >= min.x && px <= max.x && pz >= min.z && pz <= max.z;
  }

  /** Maps hit X position → 0-1 pitch value. */
  xToYNorm(px) {
    const { min, max } = this.getBounds();
    return Math.max(0, Math.min(1, (px - min.x) / (max.x - min.x)));
  }

  // ── Pattern ──────────────────────────────────────────────────────────────────
  activateStep(step, yNorm, velocity) {
    if (this.isLocked) return;
    Object.assign(this.pattern[step], { active: true, yNorm, velocity });
  }

  deactivateStep(step) { this.pattern[step].active = false; }
  clearPattern()       { this.pattern.forEach(s => { s.active = false; }); }
  lockPattern()        { this.isLocked = true; }
  unlockPattern()      { this.isLocked = false; }

  get activeStepCount() { return this.pattern.filter(s => s.active).length; }

  // ── Selection ────────────────────────────────────────────────────────────────
  select()   { this.isSelected = true;  this._outline.material.visible = true; }
  deselect() { this.isSelected = false; this._outline.material.visible = false; }

  // ── Flash ────────────────────────────────────────────────────────────────────
  flash() {
    this._mesh.material.emissiveIntensity = 1.8;
    this._flashTimer = 140;
  }

  scheduleFlash(toneTime) {
    if (this._scheduleFlashFn) this._scheduleFlashFn(this, toneTime);
    else this.flash();
  }

  /** Call every frame with delta in milliseconds. */
  update(deltaMs) {
    if (this._flashTimer > 0) {
      this._flashTimer = Math.max(0, this._flashTimer - deltaMs);
      this._mesh.material.emissiveIntensity = 0.08 + (this._flashTimer / 140) * 1.72;
    }
  }
}
