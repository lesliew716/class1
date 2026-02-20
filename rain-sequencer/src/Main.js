/**
 * Main.js — Entry point.
 * Wires Three.js scene ↔ RainSystem ↔ Sequencer ↔ AudioEngine ↔ UIController.
 */

import * as THREE from 'three';

import { AudioEngine }  from './AudioEngine.js';
import { Sequencer }    from './Sequencer.js';
import { Surface }      from './Surface.js';
import { RainSystem }   from './RainSystem.js';
import { UIController } from './UIController.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const SURFACE_Y    = 0;
const SCENE_BOUNDS = 8;
const MAX_SURFACES = 8;

// ── Global state ──────────────────────────────────────────────────────────────
let renderer, camera, scene, ghost;
let audioEngine, sequencer, rainSystem, ui;

const surfaces   = [];
let selectedMat  = 'metal';
let selectedSurf = null;
let isPlaying    = false;

const raycaster  = new THREE.Raycaster();
const mouse      = new THREE.Vector2();
const placePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);

let lastTime = 0;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  buildRenderer();
  buildScene();
  initSystems();
  bindEvents();
  renderer.setAnimationLoop(tick);
}

// ── Renderer ──────────────────────────────────────────────────────────────────
function buildRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas:    document.getElementById('three-canvas'),
    antialias: true,
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
function buildScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog        = new THREE.FogExp2(0x0a0e14, 0.055);

  // Camera
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 8, 14);
  camera.lookAt(0, 0, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0x334455, 1.4));

  const sun = new THREE.DirectionalLight(0x7fb8d8, 2.5);
  sun.position.set(5, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(1024);
  Object.assign(sun.shadow.camera, { near: 1, far: 50, left: -15, right: 15, top: 15, bottom: -15 });
  scene.add(sun);

  // Accent purple fill from below
  const fill = new THREE.PointLight(0x7c4dff, 0.9, 22);
  fill.position.set(-4, -2, 2);
  scene.add(fill);

  // Wet floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x0d1520, roughness: 0.08, metalness: 0.5 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.5;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid helper
  const grid = new THREE.GridHelper(20, 20, 0x1a2234, 0x1a2234);
  grid.position.y = -0.49;
  scene.add(grid);

  // Ghost placement preview
  ghost = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.08, 2),
    new THREE.MeshStandardMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.22, depthWrite: false })
  );
  ghost.visible = false;
  scene.add(ghost);
}

// ── Systems ───────────────────────────────────────────────────────────────────
function initSystems() {
  audioEngine = new AudioEngine();
  sequencer   = new Sequencer(audioEngine);
  rainSystem  = new RainSystem(THREE, scene, onRaindropHit);

  ui = new UIController({
    onMaterialSelect: (t) => { selectedMat = t; },
    onBpmChange:      (v) => { sequencer.bpm = v; },
    onRainChange:     (v) => { rainSystem.setIntensity(v); },
    onScaleChange:    (n) => { audioEngine.setScale(n); },
    onWeatherChange:  (n) => { rainSystem.setWeather(n); },
    onPlayToggle:     ()  => togglePlay(),
    onClear:          ()  => clearAll(),
    onLockPattern:    (s) => { s.isLocked ? s.unlockPattern() : s.lockPattern(); },
    onDeleteSurface:  (s) => deleteSurface(s),
    onGameStart:      ()  => startGame(),
  });

  ui.init();

  sequencer.onStep = (step) => ui.onStep(step);
  sequencer.onLoop = (n)    => ui.onLoop(n);
}

// ── Game start ────────────────────────────────────────────────────────────────
async function startGame() {
  await audioEngine.init();
  sequencer.init();       // sync (no async needed now)
  rainSystem.start();
  ui.toast('Click the ground to place a surface — rain does the rest', 5000);
}

// ── Play / Stop ───────────────────────────────────────────────────────────────
function togglePlay() {
  if (!isPlaying) {
    isPlaying = true;
    sequencer.start();
  } else {
    isPlaying = false;
    sequencer.stop();
    ui.syncGrid();
  }
}

// ── Surface management ────────────────────────────────────────────────────────
function placeSurface(worldPos) {
  if (surfaces.length >= MAX_SURFACES) {
    ui.toast('Maximum 8 surfaces reached');
    return;
  }

  deselectAll();

  const pos = new THREE.Vector3(
    Math.round(worldPos.x * 2) / 2,
    SURFACE_Y,
    Math.round(worldPos.z * 2) / 2
  );

  const surf = new Surface(THREE, selectedMat, pos);

  // Wire scheduled flash: approximate audio-to-visual timing
  surf._scheduleFlashFn = (s, toneTime) => {
    // Import Tone here via dynamic access (already loaded as static import in Sequencer)
    // We use a small setTimeout offset derived from scheduled time vs now.
    const now   = performance.now() / 1000;
    const delay = Math.max(0, (toneTime - now) * 1000 - 20);
    setTimeout(() => { s.flash(); ui.flashSurfaceRow(s); }, delay);
  };

  scene.add(surf.mesh);
  surfaces.push(surf);
  sequencer.addSurface(surf);
  rainSystem.registerSurface(surf);
  ui.addSurfaceRow(surf);
  ui.addScore(25);
  ui.toast(`${selectedMat.toUpperCase()} placed — rain will compose it`);
}

function selectSurface(surf) {
  if (selectedSurf && selectedSurf !== surf) selectedSurf.deselect();
  selectedSurf = surf;
  surf.select();
  ui.showInfoPanel(surf);
}

function deselectAll() {
  if (selectedSurf) { selectedSurf.deselect(); selectedSurf = null; }
  ui.hideInfoPanel();
}

function deleteSurface(surf) {
  scene.remove(surf.mesh);
  const i = surfaces.indexOf(surf);
  if (i !== -1) surfaces.splice(i, 1);
  sequencer.removeSurface(surf);
  rainSystem.unregisterSurface(surf);
  ui.removeSurfaceRow(surf);
  if (selectedSurf === surf) { selectedSurf = null; ui.hideInfoPanel(); }
  ui.toast(`${surf.materialType.toUpperCase()} removed`);
}

function clearAll() {
  for (const s of [...surfaces]) deleteSurface(s);
}

// ── Raindrop hit ──────────────────────────────────────────────────────────────
function onRaindropHit(surface, px, pz, velNorm, yNorm) {
  if (!audioEngine.isReady) return;
  sequencer.recordHit(surface, yNorm, 0.4 + velNorm * 0.6);
  ui.addScore(1);
  ui.updateInfoPanel();
}

// ── Input ─────────────────────────────────────────────────────────────────────
function bindEvents() {
  const cv = renderer.domElement;
  cv.addEventListener('mousemove', onMouseMove);
  cv.addEventListener('click',     onClick);
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); deselectAll(); });
  window.addEventListener('resize',  onResize);
  window.addEventListener('keydown', onKey);
}

function toNDC(event) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((event.clientX - r.left) / r.width)  * 2 - 1;
  mouse.y = -((event.clientY - r.top)  / r.height) * 2 + 1;
}

function hitSurfaces() {
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(surfaces.map(s => s.mesh), false);
}

function groundPoint() {
  raycaster.setFromCamera(mouse, camera);
  const p = new THREE.Vector3();
  raycaster.ray.intersectPlane(placePlane, p);
  return p;
}

function clamp(v) {
  v.x = Math.max(-SCENE_BOUNDS, Math.min(SCENE_BOUNDS, v.x));
  v.z = Math.max(-SCENE_BOUNDS, Math.min(SCENE_BOUNDS, v.z));
  return v;
}

function onMouseMove(e) {
  toNDC(e);
  if (hitSurfaces().length > 0) {
    ghost.visible = false;
  } else {
    const p = groundPoint();
    if (p) {
      clamp(p);
      ghost.position.set(Math.round(p.x * 2) / 2, SURFACE_Y + 0.04, Math.round(p.z * 2) / 2);
      ghost.visible = true;
    }
  }
}

function onClick(e) {
  if (e.target !== renderer.domElement) return;
  toNDC(e);

  const hits = hitSurfaces();
  if (hits.length > 0) {
    const s = surfaces.find(s => s.mesh === hits[0].object);
    if (s) { selectSurface(s); return; }
  }

  const p = groundPoint();
  if (p) placeSurface(clamp(p));
}

function onKey(e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedSurf) deleteSurface(selectedSurf);
  }
  if (e.key === 'Escape') deselectAll();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ── Render loop ───────────────────────────────────────────────────────────────
function tick(time) {
  const now    = time ?? performance.now();
  const deltaS = Math.min((now - lastTime) / 1000, 0.1);
  lastTime     = now;

  for (const s of surfaces) s.update(deltaS * 1000);
  rainSystem.update(deltaS);
  renderer.render(scene, camera);
}

bootstrap().catch(console.error);
