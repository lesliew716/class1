# Rain Sequencer — Full System Design Document

## Concept

An interactive audiovisual experience where players place physical material surfaces into a rain environment. Falling raindrops trigger distinct sounds per material, which are quantized into a 16-step loop. Over time, random rain patterns evolve into intentional rhythmic and melodic compositions. The project is equal parts game and creative music tool.

---

## 1. Core Game Loop

### Short-Term Objective (per session)
The player's immediate goal is to place a surface and hear it respond to rain. Each raindrop hit produces a sound and activates a step in the sequencer grid. Within the first 4-8 bars, a loop begins to form. The player can see which steps are active on the grid and adjust surface positions to influence which pitches are hit.

```
Place surface → Rain hits it → Sound triggers → Step activates → Loop plays → Hear your composition
```

### Long-Term Progression (session arc)
1. **Exploration phase (0-200 pts):** Start with 3 unlocked materials (metal, glass, wood). Learn how rain density and surface position affect pattern density and pitch range.
2. **Layering phase (200-800 pts):** Unlock lotus and stone. Stack polyrhythmic patterns across up to 8 surfaces. Discover how different materials complement each other timbrally.
3. **Refinement phase (800+ pts):** Unlock new scales (major, blues), lock preferred patterns, manually toggle unwanted steps off. Move surfaces left/right to shift pitch. Change weather type for dynamic intensity.

### Win Condition / Advancement
There is no "fail state." Advancement is measured by score, which accumulates from:
- Raindrop hits (+1 per hit)
- Completing loops (+10 base + density bonus up to +50)
- Placing surfaces (+25)

Score gates unlock new materials, scales, and weather types. This creates a feel of progression without punishment.

### Preventing Randomness Fatigue
Several mechanisms push the experience from chaos toward coherence:
- **Pentatonic scale default:** All pitches are constrained to 5-note pentatonic by default. Any combination of notes sounds good together — dissonance is structurally impossible.
- **Step locking:** Players can lock a surface's pattern to freeze it as a stable loop foundation, then let other surfaces continue evolving around it.
- **Manual step editing:** The grid cells are clickable — players can deactivate unwanted steps that feel "wrong," turning random hits into curated patterns.
- **Pitch-by-position:** A surface's pitch range is controlled by where raindrops hit along its X-axis. Moving a surface left/right shifts the note distribution, allowing melodic shaping.

---

## 2. Interaction Design

### Surface Placement
- **Click** on the ground plane places a surface at the nearest 0.5-unit grid snap.
- A ghost preview mesh (translucent) tracks the mouse before placement.
- Maximum 8 surfaces prevent screen clutter and maintain clarity.
- **Right-click** deselects. **Delete key** removes selected surface.

### Rain Intensity Controls
- Slider (1–10). Maps to drops-per-second via `WEATHER_PRESET.count × intensity / 5`.
- Higher intensity = denser pattern fill, faster score accumulation, busier sound.
- Weather type (drizzle/rain/storm) changes drop speed, spread, and opacity independently from intensity.

### Locking Patterns
- Lock button in the surface info panel.
- Locked surfaces: pattern array is read-only (new raindrop hits are ignored for pattern writing), but the loop still plays.
- Outline turns solid instead of wireframe when locked.
- Intended workflow: compose a rhythm, lock it as a foundation, layer melodic surfaces above.

### Editing / Deleting / Moving
- **Select:** Click a placed surface. Info panel appears (right side).
- **Delete:** Delete key or panel button. Surface and its sequencer row are removed cleanly.
- **Manual step toggle:** Click any cell in the sequencer grid row to toggle it.
- **Move:** (Phase 2 feature) Click + drag. Drag along X-axis shifts pitch. Drag along Z-axis shifts spatial position.

### Visual Rhythm Feedback
- **Playing column:** Current sequencer step column flashes white across all rows.
- **Playhead bar:** Horizontal progress bar at bottom of sequencer panel.
- **Surface flash:** Material mesh emissive intensity spikes on hit, decays over 120ms.
- **Grid row flash:** Entire sequencer row briefly highlights on active step.
- **Splash particles:** Expanding ring effect at hit location on the surface.
- **Loop counter:** Displays number of completed loops.

---

## 3. Music System Design

### Material → Timbre Mapping

| Material | Synth Type     | Character            | Pitch Range  |
|----------|---------------|----------------------|--------------|
| Metal    | FMSynth       | Bright, metallic ring | Full range   |
| Glass    | Sine envelope  | Airy bell, long tail  | High only    |
| Wood     | MembraneSynth  | Warm marimba thud    | Mid-low      |
| Lotus    | Sine + LPF     | Soft, underwater pad  | Low only     |
| Stone    | NoiseSynth    | Brown noise burst, deep | Lowest    |

This creates a natural frequency stratification: stone and lotus occupy the bass, wood the mid, metal and glass the treble. Multiple surfaces naturally form a mix without heavy tuning.

### Raindrop Timing → Quantized Grid

```
Raindrop hits surface at audio time T
  ↓
Sequencer._quantizeNow() reads Transport.ticks
  ↓
ticks % (stepLen * 16) / stepLen → nearest step index (0-15)
  ↓
surface.pattern[step].active = true
  ↓
On next loop iteration, Tone.Sequence fires that step
  ↓
AudioEngine.triggerAtTime(material, yNorm, velocity, toneTime)
```

The quantization rounds to the **nearest** 16th note, not the next one. This means a drop halfway between two steps goes to whichever is closer — feels more musical than always-forward snapping.

### Pitch System

**Approach: Scale-constrained pitch from spatial position**

- The X position of raindrop impact on a surface maps to a normalized `yNorm` (0.0 = left edge, 1.0 = right edge).
- `yNorm` indexes into the selected scale's offset array.
- The material's `pitchRange` clamps `yNorm` to a sub-range (e.g. Glass only uses the upper half of the scale).
- Root is C4 (MIDI 60). Two octaves of scale degrees are available.

**Why not fixed pitch?** Fixed pitch would make all surfaces of the same type sound identical. Spatial mapping gives each surface a unique melodic character based on placement.

**Why not fully dynamic/random?** Fully random pitch (even within a scale) produces a monotonous texture. Spatial grounding means intentional placement produces intentional pitch results.

### Avoiding Dissonance

1. **Pentatonic default:** C, D, E, G, A. No tritones. Every interval combination is consonant.
2. **Per-material pitch ranges:** Stone and lotus never play in the same register as glass, preventing frequency masking and tonal clash.
3. **Reverb glue:** Shared reverb bus ties all materials into one acoustic space.
4. **Scale lock:** Changing scale mid-session only affects newly triggered notes, not locked patterns.

### Randomness → Coherence Progression

```
Phase 1 (first 2 loops):  All 16 steps empty. Single drops hit sporadically.
Phase 2 (loops 3-6):      Pattern begins filling. Some steps hit multiple times = darker cells.
Phase 3 (loops 7+):       Dense patterns emerge. Player starts selectively deleting steps.
Phase 4 (any time):       Player locks a stable pattern, layers second material on top.
```

The system naturally evolves toward density, then the player refines by subtracting. This mirrors the way real composers work — generate material, then edit.

---

## 4. Reward / Progression

| Score | Unlock             | Description                              |
|-------|--------------------|------------------------------------------|
| 200   | Lotus surface      | Soft pad texture, anchors the low end    |
| 500   | Stone surface      | Noise percussion, drives rhythm          |
| 800   | Major scale        | Opens brighter, more structured tonality |
| 1200  | Blues scale        | Adds expressive minor color              |
| 1800  | Drizzle weather    | Slower drops = sparser, more deliberate  |
| 2500  | Storm weather      | Dense drops = rapid pattern fill         |

**Scoring system:**
- `+1` per raindrop hit on any surface
- `+10 to +50` per loop completed (based on pattern density)
- `+25` per surface placed
- Score is session-persistent (no save), resets on clear

**Achievement pop-up:** A centered overlay appears with icon + unlock name, auto-dismisses after 3.5s. Non-blocking — the game continues behind it.

---

## 5. UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ☁ RAIN SEQUENCER │ BPM ─────── 90  RAIN ───── 4 │ ▶ START  ✕  │  ← top bar
├──────────┬──────────────────────────────────────────────────────┤
│ SURFACES │                                                       │
│          │          3D SCENE (Three.js canvas)                  │
│ [METAL]  │                                                       │
│ [GLASS]  │   ghost preview follows mouse                        │
│ [WOOD]   │   placed surfaces with splash fx                     │
│ [LOTUS🔒]│   rain streaks falling                               │
│ [STONE🔒]│                                                    [info]
│ ──────── │                                                    panel│
│ SCALE    │                                                    right│
│ ──────── │                                                       │
│ WEATHER  │                                                       │
├──────────┴──────────────────────────────────────────────────────┤
│ SEQUENCER — 16 STEPS                       LOOP: 12             │
│ METAL  [■][■][ ][■] [■][ ][ ][■] [■][ ][■][■] [ ][■][ ][ ]   │
│ GLASS  [ ][■][ ][ ] [ ][■][ ][ ] [ ][■][ ][ ] [■][ ][ ][ ]   │
│ WOOD   [■][ ][■][ ] [■][ ][■][ ] [■][ ][■][ ] [■][ ][■][ ]   │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  playhead │
└─────────────────────────────────────────────────────────────────┘
```

**Aesthetic direction:** Minimal, dark, technical. Monospace fonts. Muted blue-grey palette with cyan accent for active states and purple for loop/score highlights. Feels like a scientific instrument or a modular synthesizer panel, not a game UI. The 3D scene provides warmth through the rain particle lighting.

---

## 6. Technical Architecture

```
Main.js
├── Three.js scene (renderer, camera, lights, floor, ghost mesh)
├── Event handling (mouse, keyboard, resize)
├── surfaces[] registry
└── requestAnimationFrame loop → tick()
    ├── surface.update(deltaMs)    ← flash decay
    ├── rainSystem.update(deltaS) ← physics + collision
    └── renderer.render()

RainSystem.js
├── Particle pool (flat typed arrays, 300 slots max)
├── update(deltaS)
│   ├── _spawnDrop()              ← fills pool slots
│   ├── _checkSurfaceCollisions() ← AABB per drop
│   └── _updateSplashes()        ← ring FX
└── onHit callback → Sequencer.recordHit()

Sequencer.js
├── Tone.Transport (BPM, loop 1 bar)
├── Tone.Sequence (16 steps, '16n')
├── _onTick(time, step)
│   ├── fires AudioEngine.triggerAtTime() for active steps
│   └── calls onStep() → UIController.onStep()
├── recordHit(surface, yNorm, vel)
│   ├── AudioEngine.trigger()    ← immediate live sound
│   ├── surface.flash()          ← visual
│   └── surface.activateStep()  ← writes pattern
└── quantizeNow()                ← Transport.ticks → step index

AudioEngine.js
├── Tone.FMSynth     ← metal
├── Tone.Synth(sine) ← glass
├── Tone.MembraneSynth ← wood
├── Tone.Synth(sine)+LPF ← lotus
├── Tone.NoiseSynth  ← stone
├── Tone.Reverb → Tone.Channel → Destination
├── trigger(material, yNorm, vel)
│   ├── yNorm → scale index → MIDI → frequency
│   └── synth.triggerAttackRelease(freq, '8n', time)
└── setScale(name)

Surface.js
├── Three.js Mesh (BoxGeometry, MeshStandardMaterial)
├── Outline Mesh (wireframe, toggle on select)
├── pattern[16]: StepData[]
│   └── { active, yNorm, velocity }
├── getBounds()       ← AABB for collision
├── containsPoint()   ← fast XZ test
├── xToYNorm()        ← X pos → pitch 0-1
├── activateStep()    ← writes to pattern
└── update(deltaMs)   ← flash emissive decay

UIController.js
├── DOM bindings (sliders, buttons, palette, selects)
├── Sequencer grid (addSurfaceRow, onStep, syncGrid)
├── Score + unlock system (UNLOCKS[], checkUnlocks())
├── Toast notifications
├── Achievement overlay
└── Info panel (selected surface)
```

### Key Data Flow: Collision → Sound → Grid

```
RainSystem._checkSurfaceCollisions(i)
  → onHit(surface, px, pz, velNorm, yNorm)        [Main.js]
    → Sequencer.recordHit(surface, yNorm, vel)
      → AudioEngine.trigger(material, yNorm, vel)  [immediate]
      → surface.flash()                            [visual]
      → surface.activateStep(step, yNorm, vel)     [pattern write]
        → surface.pattern[step].active = true

Tone.Sequence tick at next bar iteration
  → Sequencer._onTick(time, step)
    → AudioEngine.triggerAtTime(material, yNorm, vel, time)  [scheduled]
    → surface.scheduleFlash(time)                            [visual sync]
    → UIController.onStep(step)                              [grid highlight]
```

### Performance Considerations

- **Object pool:** Raindrops use flat `Float32Array` — no GC pressure.
- **LineSegments:** Single draw call for all 300 potential drops, updated via `BufferAttribute.needsUpdate`.
- **No physics engine:** Collision is pure AABB (4 comparisons per drop per surface). At 300 drops × 8 surfaces = 2400 comparisons/frame — negligible.
- **Tone.js scheduling:** All sequencer sounds use `triggerAtTime()` with pre-scheduled audio-context times. No setTimeout jitter in the audio thread.
- **Shadow map:** Single directional light with 1024px shadow map. Surfaces and floor receive shadows; rain particles do not.

---

## Implementation Notes for Phase 2

- **Surface dragging:** Add `PointerEvents` for mousedown/up delta tracking. Translate mesh along XZ plane.
- **MIDI export:** Serialize `surface.pattern[]` to MIDI events using `midi-writer-js`.
- **Mobile support:** Replace mouse events with touch events. Simplify rain count to 80 for mobile GPU budget.
- **Harmony scoring:** Award bonus points when the ratio of unique pitches in active steps matches chord intervals (3rds, 5ths).
- **Recording mode:** Capture the audio output using `Tone.Recorder` and allow WAV download.
