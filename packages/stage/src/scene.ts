import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCharacter, type CharacterRig } from './character.js';
import { PerformanceScore, trackRole, type PerformanceSnapshot } from './score.js';
import { animatePerformer, createInstrument } from './animation.js';

export interface StageOptions {
  readPerformance: () => PerformanceSnapshot;
  onError?: (message: string) => void;
  reducedMotion?: boolean;
}
export interface StageView { dispose(): void; resetCamera(): void }
const palette = ['#e5d6b5', '#c1b7e4', '#b6d4c5', '#e6bcb4', '#b8cee5', '#e1cc99'];

/** Owns one WebGL context. Call dispose whenever the modal closes. */
export function createStage(container: HTMLElement, options: StageOptions): StageView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Animated band, one character for each music track');
  renderer.domElement.setAttribute('role', 'img');
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9e4ec');
  scene.fog = new THREE.Fog('#e9e4ec', 24, 65);
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = .45;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 4;
  controls.maxDistance = 60;
  scene.add(new THREE.HemisphereLight('#fff6ed', '#9a8aa8', 2.7));
  const key = new THREE.DirectionalLight('#fff1dc', 3.5);
  key.position.set(-5, 9, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18 });
  key.shadow.bias = -.0005;
  key.shadow.normalBias = .04;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#d9d0ff', 2.2);
  rim.position.set(4, 5, -6); scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#ddd5e3', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.16; ground.receiveShadow = true; scene.add(ground);
  const cast = new THREE.Group(); scene.add(cast);
  const score = new PerformanceScore();
  let signature = '';
  let performers: { rig: CharacterRig; anchor: THREE.Group; instrument: THREE.Group }[] = [];
  let columns = 1, rows = 1;
  let disposed = false;
  const ownedTextures = new Set<THREE.Texture>();

  function disposeObjects(group: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.LineSegments) {
        if ('geometry' in object) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }
  function label(text: string, subtitle: string): THREE.Sprite {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.textAlign = 'center'; ctx.fillStyle = '#51485d'; ctx.font = '600 32px system-ui';
    const title = text.length > 22 ? `${text.slice(0, 21)}…` : text;
    ctx.fillText(title, 256, 48, 490);
    ctx.fillStyle = '#82758e'; ctx.font = '500 21px system-ui'; ctx.fillText(subtitle.toUpperCase(), 256, 85);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.add(texture);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    sprite.scale.set(2.9, .725, 1); sprite.position.set(0, 3.08, 0); return sprite;
  }
  function rebuild(snapshot: PerformanceSnapshot) {
    performers.forEach(({ rig }) => { rig.root.removeFromParent(); rig.dispose(); });
    disposeObjects(cast); cast.clear();
    ownedTextures.forEach(texture => texture.dispose()); ownedTextures.clear();
    const tracks = snapshot.program.tracks;
    performers = tracks.map((track, index) => {
      const anchor = new THREE.Group();
      const rig = createCharacter({ color: palette[index % palette.length] });
      anchor.add(rig.root);
      const role = trackRole(track);
      const instrument = createInstrument(role, rig);
      anchor.add(instrument);
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.55, .16, 64), new THREE.MeshStandardMaterial({ color: '#f5f0f6', roughness: .9 }));
      platform.position.y = -.08; platform.receiveShadow = true; anchor.add(platform);
      anchor.add(label(track.name, track.source.name.split('/')[1]!));
      cast.add(anchor);
      return { rig, anchor, instrument };
    });
    renderer.domElement.dataset.characterCount = String(performers.length);
    layout(); resetCamera();
  }
  function layout() {
    columns = Math.min(camera.aspect < .85 ? 2 : camera.aspect < 1.4 ? 3 : 5, Math.max(1, performers.length));
    rows = Math.max(1, Math.ceil(performers.length / columns));
    performers.forEach(({ anchor }, index) => {
      const row = Math.floor(index / columns), count = Math.min(columns, performers.length - row * columns);
      anchor.position.set((index % columns - (count - 1) / 2) * 3.4, 0, (row - (rows - 1) / 2) * -4.2);
    });
  }
  function resetCamera() {
    const halfWidth = (columns - 1) * 1.7 + 1.6, halfDepth = (rows - 1) * 2.1 + 1.6;
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const elevation = .48, sin = Math.sin(elevation), cos = Math.cos(elevation);
    let distance = 6;
    for (const y of [-1.6, 1.9]) for (const z of [-halfDepth, halfDepth]) {
      const viewY = y * cos - z * sin, viewZ = y * sin + z * cos;
      distance = Math.max(distance, viewZ + Math.max(halfWidth / (tangent * camera.aspect), Math.abs(viewY) / tangent));
    }
    distance *= 1.07;
    camera.position.set(0, 1.5 + distance * sin, distance * cos);
    controls.target.set(0, 1.5, 0); controls.update();
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); layout(); resetCamera();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); resize();
  function contextLost(event: Event) { event.preventDefault(); renderer.setAnimationLoop(null); options.onError?.('The 3D view lost its graphics connection. Close the stage and reopen it to retry.'); }
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.setAnimationLoop(() => {
    if (disposed || document.hidden) return;
    try {
      const snapshot = options.readPerformance();
      const nextSignature = JSON.stringify(snapshot.program.tracks.map(track => [track.name, track.source]));
      if (nextSignature !== signature) { signature = nextSignature; rebuild(snapshot); }
      const motions = score.sample(snapshot);
      performers.forEach(({ rig, instrument }, index) => {
        rig.resetPose();
        const motion = motions[index]!;
        animatePerformer(trackRole(snapshot.program.tracks[index]!), rig, options.reducedMotion ? { ...motion, playing: false, active: false, energy: 0 } : motion, instrument);
      });
      renderer.domElement.dataset.playing = String(snapshot.state.playing);
      renderer.domElement.dataset.beat = (motions[0]?.beat ?? 0).toFixed(3);
      controls.update(); renderer.render(scene, camera);
    } catch (error) {
      renderer.setAnimationLoop(null);
      options.onError?.(error instanceof Error ? error.message : 'Could not render the band.');
    }
  });
  return {
    resetCamera,
    dispose() {
      if (disposed) return; disposed = true;
      renderer.setAnimationLoop(null); resizeObserver.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      performers.forEach(({ rig }) => { rig.root.removeFromParent(); rig.dispose(); });
      disposeObjects(scene); ownedTextures.forEach(texture => texture.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
