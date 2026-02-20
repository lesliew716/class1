/**
 * RainSystem.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Particle-based rain using Three.js instanced or point-sprite geometry.
 *
 * Architecture decisions:
 *   • Object pool: raindrops are recycled, never created/destroyed mid-loop.
 *   • Each drop is a thin capsule (line segment) rendered via LineSegments
 *     for performance (no instancing overhead, GPU-friendly).
 *   • Collision is a simple Y-threshold check per frame (no physics engine).
 *   • SpawnArea is a horizontal rectangle at the top of the scene.
 *
 * Weather presets:
 *   drizzle  → 30 drops, slow, thin
 *   rain     → 120 drops, medium
 *   storm    → 300 drops, fast, wide spread
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Pool slot states
const ALIVE = 1;
const DEAD  = 0;

// Weather presets
const WEATHER_PRESETS = {
  drizzle: { count: 40,  speed: [2,  3.5], spread: 6,  length: 0.18, opacity: 0.5 },
  rain:    { count: 120, speed: [4,  7],   spread: 10, length: 0.28, opacity: 0.7 },
  storm:   { count: 300, speed: [8, 14],   spread: 16, length: 0.45, opacity: 0.9 },
};

export class RainSystem {
  /**
   * @param {object} THREE    - Three.js namespace
   * @param {THREE.Scene} scene
   * @param {function} onHit  - (surface, px, pz, speed) => void
   */
  constructor(THREE, scene, onHit) {
    this._THREE   = THREE;
    this._scene   = scene;
    this._onHit   = onHit;

    this._surfaces    = [];      // registered Surface instances
    this._intensity   = 5;       // 1-10 slider
    this._weatherType = 'rain';
    this._running     = false;

    // Pool arrays (flat, parallel arrays for cache friendliness)
    this._maxDrops = 300;
    this._state    = new Uint8Array(this._maxDrops);   // ALIVE/DEAD
    this._px       = new Float32Array(this._maxDrops); // x
    this._py       = new Float32Array(this._maxDrops); // y (top of drop)
    this._pz       = new Float32Array(this._maxDrops); // z
    this._vy       = new Float32Array(this._maxDrops); // downward speed

    // Three.js geometry: each drop = 2 vertices (top, bottom of streak)
    this._positions = new Float32Array(this._maxDrops * 2 * 3); // xyz * 2 per drop
    this._geo       = new THREE.BufferGeometry();
    this._geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this._positions, 3)
    );
    this._geo.setDrawRange(0, 0);   // start empty

    const mat = new THREE.LineBasicMaterial({
      color:       0x90caf9,
      transparent: true,
      opacity:     0.7,
      linewidth:   1,           // >1 only works in WebGL2 or with specific extensions
    });

    this._lineSegments = new THREE.LineSegments(this._geo, mat);
    this._lineSegments.frustumCulled = false;
    this._scene.add(this._lineSegments);

    // Splash particle pool (small burst on hit)
    this._splashes = [];
    this._maxSplashes = 60;
    this._initSplashPool();

    // Spawn parameters (recalculated on weather/intensity change)
    this._preset    = { ...WEATHER_PRESETS.rain };
    this._spawnY    = 12;         // drop birth height
    this._floorY    = -4;         // drop death height (below visible floor)
    this._activeCount = 0;
    this._spawnAccum  = 0;        // fractional drop accumulator
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start() { this._running = true; }
  stop()  { this._running = false; }

  setWeather(type) {
    if (!WEATHER_PRESETS[type]) return;
    this._weatherType = type;
    this._preset = { ...WEATHER_PRESETS[type] };
    this._lineSegments.material.opacity = this._preset.opacity;
  }

  /** intensity: 1-10 */
  setIntensity(value) {
    this._intensity = Math.max(1, Math.min(10, value));
  }

  registerSurface(surface)   { this._surfaces.push(surface); }
  unregisterSurface(surface) {
    const idx = this._surfaces.indexOf(surface);
    if (idx !== -1) this._surfaces.splice(idx, 1);
  }

  // ── Update (called every animation frame) ──────────────────────────────────

  /**
   * @param {number} deltaS  - seconds since last frame
   */
  update(deltaS) {
    if (!this._running) return;

    const preset  = this._preset;
    const spawnRatePerSec = (preset.count * this._intensity) / 5;

    // Spawn new drops
    this._spawnAccum += spawnRatePerSec * deltaS;
    while (this._spawnAccum >= 1) {
      this._spawnDrop();
      this._spawnAccum -= 1;
    }

    // Update alive drops
    let aliveCount = 0;
    for (let i = 0; i < this._maxDrops; i++) {
      if (this._state[i] === DEAD) continue;

      this._py[i] -= this._vy[i] * deltaS;

      // Check collisions with all surfaces
      if (this._checkSurfaceCollisions(i)) {
        this._killDrop(i);
        continue;
      }

      // Kill drops below floor
      if (this._py[i] < this._floorY) {
        this._killDrop(i);
        continue;
      }

      // Write positions: top vertex then bottom vertex
      const base = i * 6;
      this._positions[base    ] = this._px[i];
      this._positions[base + 1] = this._py[i];
      this._positions[base + 2] = this._pz[i];
      this._positions[base + 3] = this._px[i];
      this._positions[base + 4] = this._py[i] - preset.length;
      this._positions[base + 5] = this._pz[i];

      aliveCount++;
    }

    // Compact geometry draw range (simple approach: mark all)
    this._geo.attributes.position.needsUpdate = true;
    this._geo.setDrawRange(0, this._maxDrops * 2);

    // Update splash particles
    this._updateSplashes(deltaS);
  }

  // ── Spawn ───────────────────────────────────────────────────────────────────

  _spawnDrop() {
    // Find a dead slot
    for (let i = 0; i < this._maxDrops; i++) {
      if (this._state[i] === DEAD) {
        const spread = this._preset.spread;
        const [vMin, vMax] = this._preset.speed;

        this._px[i] = (Math.random() - 0.5) * spread * 2;
        this._py[i] = this._spawnY + Math.random() * 2;
        this._pz[i] = (Math.random() - 0.5) * spread * 2;
        this._vy[i] = vMin + Math.random() * (vMax - vMin);
        this._state[i] = ALIVE;
        return;
      }
    }
    // Pool exhausted — silently skip
  }

  _killDrop(i) {
    // Zero out geometry vertices so they don't render
    const base = i * 6;
    for (let j = 0; j < 6; j++) this._positions[base + j] = 0;
    this._state[i] = DEAD;
  }

  // ── Collision ───────────────────────────────────────────────────────────────

  _checkSurfaceCollisions(i) {
    const px = this._px[i];
    const py = this._py[i];
    const pz = this._pz[i];

    for (const surface of this._surfaces) {
      const bounds = surface.getBounds();
      // Y: drop must be at or just above the surface top
      if (py > bounds.max.y + 0.5) continue;    // still above
      if (py < bounds.min.y - 0.1) continue;    // below surface

      if (surface.containsPoint(px, pz)) {
        // Compute normalised pitch position (X across surface width)
        const yNorm  = surface.xToYNorm(px);
        const speed  = this._vy[i];
        const velNorm = Math.min(1, (speed - 2) / 12);

        this._onHit(surface, px, pz, velNorm, yNorm);
        this._spawnSplash(px, bounds.max.y + 0.05, pz);
        return true;
      }
    }
    return false;
  }

  // ── Splash pool ─────────────────────────────────────────────────────────────

  _initSplashPool() {
    const THREE = this._THREE;
    // Each splash: a tiny expanding ring (torus scaled up over time)
    const geo = new THREE.RingGeometry(0.02, 0.05, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x90caf9,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < this._maxSplashes; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this._scene.add(mesh);
      this._splashes.push({ mesh, life: 0, maxLife: 0.4 });
    }
  }

  _spawnSplash(x, y, z) {
    // Find an inactive splash
    for (const s of this._splashes) {
      if (s.life <= 0) {
        s.mesh.position.set(x, y, z);
        s.mesh.scale.setScalar(1);
        s.mesh.material.opacity = 0.8;
        s.mesh.visible = true;
        s.life = s.maxLife;
        return;
      }
    }
  }

  _updateSplashes(deltaS) {
    for (const s of this._splashes) {
      if (s.life <= 0) continue;
      s.life -= deltaS;
      const t = 1 - s.life / s.maxLife;   // 0 → 1
      s.mesh.scale.setScalar(1 + t * 3);
      s.mesh.material.opacity = 0.8 * (1 - t);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
}
