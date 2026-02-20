/**
 * Main.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point. Wires together:
 *   Three.js scene  ←→  RainSystem  ←→  Sequencer  ←→  AudioEngine
 *                                  ←→  UIController
 *
 * Responsibilities:
 *   • Build the Three.js scene (camera, lights, floor, fog, post-process)
 *   • Handle mouse/pointer events for surface placement & selection
 *   • Own the surfaces[] registry and delegate to all sub-systems
 *   • Run the main requestAnimationFrame loop
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165/build/three.module.js';
import { AudioEngine }  from './AudioEngine.js';
import { Sequencer }    from './Sequencer.js';
import { Surface }      from './Surface.js';
import { RainSystem }   from './RainSystem.js';
import { UIController } from './UIController.js';

// ── Constants ────────────────────────────────────────────────────────────────

const SURFACE_Y     = 0;          // default Y for placed surfaces
const SCENE_BOUNDS  = 8;          // +/- boundary for placement
const CAMERA_FOV    = 55;
const MAX_SURFACES  = 8;          // design cap: prevents overcrowding

// ── Global state ─────────────────────────────────────────────────────────────

let renderer, camera, scene;
let audioEngine, sequencer, rainSystem, ui;

const surfaces   = [];            // Surface[]
let selectedMat  = 'metal';       // currently chosen material in palette
let selectedSurf = null;          // currently selected Surface (or null)
let isPlaying    = false;

// Raycasting
const raycaster  = new THREE.Raycaster();
const mouse      = new THREE.Vector2();
const placePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);

// Timing
let lastTime = 0;

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  initRenderer();
  initScene();
  initSystems();
  bindWindowEvents();
  renderer.setAnimationLoop(tick);
  console.log('[Main] bootstrap complete');
}

// ── Renderer ─────────────────────────────────────────────────────────────────

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('three-canvas'),
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace   = THREE.SRGBColorSpace;
  renderer.toneMapping        = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function initScene() {
  scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog        = new THREE.FogExp2(0x0a0e14, 0.06);

  // ── Camera ──
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 8, 14);
  camera.lookAt(0, 0, 0);

  // ── Lights ──
  const ambient = new THREE.AmbientLight(0x334455, 1.2);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0x7fb8d8, 2.5);
  dirLight.position.set(5, 12, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.setScalar(1024);
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far  = 50;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top   = 15;
  dirLight.shadow.camera.bottom = -15;
  scene.add(dirLight);

  // Accent point light (purple glow from below)
  const accentLight = new THREE.PointLight(0x7c4dff, 0.8, 20);
  accentLight.position.set(-4, -2, 2);
  scene.add(accentLight);

  // ── Floor (reflective wet ground) ──
  const floorGeo = new THREE.PlaneGeometry(40, 40);
  const floorMat = new THREE.MeshStandardMaterial({
    color:     0x0d1520,
    roughness: 0.1,
    metalness: 0.4,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.5;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Grid helper (placement guide) ──
  const grid = new THREE.GridHelper(20, 20, 0x1a2234, 0x1a2234);
  grid.position.y = -0.49;
  scene.add(grid);

  // ── Ghost surface (placement preview) ──
  const ghostGeo = new THREE.BoxGeometry(3, 0.08, 2);
  const ghostMat = new THREE.MeshStandardMaterial({
    color:       0x4fc3f7,
    transparent: true,
    opacity:     0.25,
    depthWrite:  false,
  });
  window._ghost = new THREE.Mesh(ghostGeo, ghostMat);
  window._ghost.visible = false;
  scene.add(window._ghost);
}

// ── Systems ───────────────────────────────────────────────────────────────────

function initSystems() {
  audioEngine = new AudioEngine();
  sequencer   = new Sequencer(audioEngine);
  rainSystem  = new RainSystem(THREE, scene, onRaindropHit);

  ui = new UIController({
    onMaterialSelect: (type) => { selectedMat = type; },
    onBpmChange:      (bpm)  => { sequencer.bpm = bpm; },
    onRainChange:     (val)  => { rainSystem.setIntensity(val); },
    onScaleChange:    (name) => { audioEngine.setScale(name); },
    onWeatherChange:  (name) => { rainSystem.setWeather(name); },
    onPlayToggle:     ()     => togglePlay(),
    onClear:          ()     => clearAll(),
    onLockPattern:    (s)    => {
      s.isLocked ? s.unlockPattern() : s.lockPattern();
    },
    onDeleteSurface:  (s)    => deleteSurface(s),
    onGameStart:      ()     => onGameStart(),
  });

  ui.init();

  // Sequencer callbacks → UI
  sequencer.onStep = (step) => ui.onStep(step);
  sequencer.onLoop = (n)    => ui.onLoop(n);

  // Surface schedule-flash wires into the UI row
  // (set on each Surface when placed)
}

// ── Game start (after first user gesture) ────────────────────────────────────

async function onGameStart() {
  await audioEngine.init();
  await sequencer.init();
  rainSystem.start();
  ui.toast('Place surfaces into the rain to begin composing', 4000);
}

// ── Play / Stop ───────────────────────────────────────────────────────────────

async function togglePlay() {
  if (!isPlaying) {
    isPlaying = true;
    sequencer.start();
    rainSystem.start();
  } else {
    isPlaying = false;
    sequencer.stop();
    rainSystem.stop();
    ui.syncGrid();
  }
}

// ── Surface Management ────────────────────────────────────────────────────────

function placeSurface(worldPos) {
  if (surfaces.length >= MAX_SURFACES) {
    ui.toast('Maximum surfaces reached (8)');
    return;
  }

  // Deselect any current surface
  if (selectedSurf) {
    selectedSurf.deselect();
    selectedSurf = null;
    ui.hideInfoPanel();
  }

  const pos = new THREE.Vector3(
    Math.round(worldPos.x * 2) / 2,    // snap to 0.5 grid
    SURFACE_Y,
    Math.round(worldPos.z * 2) / 2
  );

  const surf = new Surface(THREE, selectedMat, pos);

  // Wire scheduled flash → UI row highlight
  surf._scheduleFlashFn = (s, toneTime) => {
    // Use setTimeout to approximate audio scheduling for visual sync
    const Tone = audioEngine._Tone;
    if (!Tone) return;
    const delay = (toneTime - Tone.now()) * 1000;
    setTimeout(() => {
      s.flash();
      ui.flashSurfaceRow(s);
    }, Math.max(0, delay));
  };

  scene.add(surf.mesh);
  surfaces.push(surf);
  sequencer.addSurface(surf);
  rainSystem.registerSurface(surf);
  ui.addSurfaceRow(surf);

  // Score bonus for placing
  ui.addScore(25);
  ui.toast(`${selectedMat.toUpperCase()} surface placed`);
}

function selectSurface(surf) {
  if (selectedSurf && selectedSurf !== surf) {
    selectedSurf.deselect();
  }
  selectedSurf = surf;
  surf.select();
  ui.showInfoPanel(surf);
}

function deselectAll() {
  if (selectedSurf) {
    selectedSurf.deselect();
    selectedSurf = null;
    ui.hideInfoPanel();
  }
}

function deleteSurface(surf) {
  scene.remove(surf.mesh);
  const idx = surfaces.indexOf(surf);
  if (idx !== -1) surfaces.splice(idx, 1);
  sequencer.removeSurface(surf);
  rainSystem.unregisterSurface(surf);
  ui.removeSurfaceRow(surf);
  if (selectedSurf === surf) {
    selectedSurf = null;
    ui.hideInfoPanel();
  }
  ui.toast(`${surf.materialType.toUpperCase()} surface removed`);
}

function clearAll() {
  for (const s of [...surfaces]) deleteSurface(s);
}

// ── Raindrop hit handler ──────────────────────────────────────────────────────

function onRaindropHit(surface, px, pz, velNorm, yNorm) {
  if (!audioEngine.isReady) return;

  // Record into sequencer (triggers sound + updates pattern)
  sequencer.recordHit(surface, yNorm, 0.4 + velNorm * 0.6);

  // Update score
  ui.addScore(1);
  ui.updateInfoPanel();
}

// ── Mouse / Pointer events ────────────────────────────────────────────────────

function bindWindowEvents() {
  const canvas = renderer.domElement;

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click',     onClick);
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); deselectAll(); });

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
}

function getMouseNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
}

function raycastSurfaces() {
  const meshes = surfaces.map(s => s.mesh);
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(meshes, false);
}

function raycastPlacePlane() {
  raycaster.setFromCamera(mouse, camera);
  const target = new THREE.Vector3();
  raycaster.ray.intersectPlane(placePlane, target);
  return target;
}

// Restrict to scene bounds
function clampToBounds(v) {
  v.x = Math.max(-SCENE_BOUNDS, Math.min(SCENE_BOUNDS, v.x));
  v.z = Math.max(-SCENE_BOUNDS, Math.min(SCENE_BOUNDS, v.z));
  return v;
}

function onMouseMove(event) {
  getMouseNDC(event);
  const hits = raycastSurfaces();

  if (hits.length > 0) {
    // Hovering a surface
    window._ghost.visible = false;
    renderer.domElement.style.cursor = 'pointer';
  } else {
    // Show ghost preview
    const worldPos = raycastPlacePlane();
    if (worldPos) {
      clampToBounds(worldPos);
      window._ghost.position.set(
        Math.round(worldPos.x * 2) / 2,
        SURFACE_Y + 0.04,
        Math.round(worldPos.z * 2) / 2
      );
      window._ghost.visible = true;
    }
    renderer.domElement.style.cursor = 'crosshair';
  }
}

function onClick(event) {
  getMouseNDC(event);

  // If click is on HUD elements, ignore
  if (event.target !== renderer.domElement) return;

  const hits = raycastSurfaces();
  if (hits.length > 0) {
    const hitSurf = surfaces.find(s => s.mesh === hits[0].object);
    if (hitSurf) {
      selectSurface(hitSurf);
      return;
    }
  }

  // Click on empty space → place surface
  const worldPos = raycastPlacePlane();
  if (worldPos) {
    clampToBounds(worldPos);
    placeSurface(worldPos);
  }
}

function onKeyDown(e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedSurf) deleteSurface(selectedSurf);
  }
  if (e.key === 'Escape') {
    deselectAll();
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ── Animation loop ────────────────────────────────────────────────────────────

function tick(time) {
  const now    = time ?? performance.now();
  const deltaS = Math.min((now - lastTime) / 1000, 0.1);   // cap at 100ms
  lastTime     = now;

  // Update all surfaces (flash decay)
  for (const s of surfaces) {
    s.update(deltaS * 1000);   // Surface.update expects ms
  }

  // Update rain
  rainSystem.update(deltaS);

  renderer.render(scene, camera);
}

// ── Start ─────────────────────────────────────────────────────────────────────

bootstrap().catch(console.error);
