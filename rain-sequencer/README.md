# Rain Sequencer

An interactive audiovisual project: place material surfaces into a rain environment. Raindrops compose music for you.

## Running locally

ES modules require an HTTP server (not `file://`). Pick any option:

```bash
# Python 3
cd rain-sequencer
python3 -m http.server 3000
# open http://localhost:3000

# Node (npx)
npx serve rain-sequencer

# VS Code → Live Server extension → right-click index.html → Open with Live Server
```

## How to play

| Action | Effect |
|---|---|
| Click ground | Place selected surface |
| Click surface | Select it (info panel appears) |
| Right-click / ESC | Deselect |
| Delete key | Remove selected surface |
| ▶ START | Begin the 16-step loop |
| Rain slider | Control drop density |
| BPM slider | Set loop tempo |
| Lock Pattern | Freeze a surface's pattern |
| Grid cells | Click to toggle steps manually |

## Tech stack

- [Three.js](https://threejs.org/) — 3D scene, rain particles, surface meshes
- [Tone.js](https://tonejs.github.io/) — audio engine, Transport, synths, reverb
- Vanilla ES modules (no bundler required)

## File structure

```
rain-sequencer/
├── index.html          # Import map + HUD markup
├── styles.css          # Dark minimal UI styles
├── src/
│   ├── Main.js         # Scene setup, input handling, RAF loop
│   ├── RainSystem.js   # Particle pool, AABB collision, splash FX
│   ├── Sequencer.js    # 16-step Tone.js Transport loop
│   ├── AudioEngine.js  # Per-material synths, scale quantization
│   ├── Surface.js      # Mesh + collider + pattern array
│   └── UIController.js # DOM bindings, grid, score, unlocks
└── DESIGN.md           # Full system design document
```
