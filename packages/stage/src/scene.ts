import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { concertLayout, concertSignals, type StagePosition } from './concert.js';
import { createScenery } from './scenery.js';
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
const palette = ['#e5d6b5', '#c1b7e4', '#b6d4c5', '#e6bcb4', '#b8cee5', '#c6dfc2', '#d9c1e5', '#c4dce2'];

/** Owns one WebGL context. Call dispose whenever the modal closes. */
export function createStage(container: HTMLElement, options: StageOptions): StageView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Animated band, one character for each music track');
  renderer.domElement.setAttribute('role', 'img');
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#080b16');
  scene.fog = new THREE.Fog('#080b16', 35, 100);
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 250);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = .45;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 4;
  controls.maxDistance = 140;
  let cameraTouched = false;
  controls.addEventListener('start', () => { cameraTouched = true; });
  scene.add(new THREE.HemisphereLight('#f4dfd1', '#222345', 1.4));
  const key = new THREE.DirectionalLight('#ffe1bb', 2.4);
  key.position.set(-3, 8, 10); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18 });
  key.shadow.bias = -.0005;
  key.shadow.normalBias = .04;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9b76ff', 2);
  rim.position.set(4, 5, -6); scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#080b15', roughness: .85, metalness: .1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.35; ground.receiveShadow = true; scene.add(ground);
  const scenery = createScenery(); scene.add(scenery.root);
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, renderTarget);
  const renderPass = new RenderPass(scene, camera);
  // Only HDR LEDs cross this threshold; diffuse plush faces stay crisp.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .28, .35, 1.8);
  const output = new OutputPass();
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output);
  const cast = new THREE.Group(); scene.add(cast);
  const score = new PerformanceScore();
  let signature = '';
  let performers: { rig: CharacterRig; anchor: THREE.Group; instrument: THREE.Group; role: ReturnType<typeof trackRole>; target: THREE.Vector3 }[] = [];
  let positions: StagePosition[] = [];
  let cameraTime = 0;
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
    ctx.textAlign = 'center'; ctx.fillStyle = '#eee5f7'; ctx.font = '600 32px system-ui';
    const title = text.length > 22 ? `${text.slice(0, 21)}…` : text;
    ctx.fillText(title, 256, 48, 490);
    ctx.fillStyle = '#a6abc3'; ctx.font = '500 21px system-ui'; ctx.fillText(subtitle.toUpperCase(), 256, 85);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.add(texture);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, toneMapped: false }));
    sprite.scale.set(2.4, .6, 1); sprite.position.set(0, .34, 1.65); return sprite;
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
      const height = role === 'drums' ? 1.1 : role === 'keys' ? .45 : .05;
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.55, height, 64), new THREE.MeshStandardMaterial({ color: '#191c2c', roughness: .3, metalness: .5 }));
      platform.name = 'riser'; platform.userData.height = height; platform.position.y = -height / 2; platform.receiveShadow = true; anchor.add(platform);
      const strip = new THREE.Mesh(new THREE.TorusGeometry(1.51, .025, 8, 64), new THREE.MeshStandardMaterial({ color: '#65ddff', emissive: role === 'keys' ? '#b264ff' : '#53deff', emissiveIntensity: 3 }));
      strip.rotation.x = Math.PI / 2; strip.position.y = -.04; anchor.add(strip);
      anchor.add(label(track.name, track.source.name.split('/')[1]!));
      cast.add(anchor);
      return { rig, anchor, instrument, role, target: new THREE.Vector3() };
    });
    renderer.domElement.dataset.characterCount = String(performers.length);
    layout(); resetCamera();
  }
  function layout() {
    positions = concertLayout(performers.map(performer => performer.role), camera.aspect < 1);
    performers.forEach(({ anchor }, index) => {
      const position = positions[index]!;
      anchor.position.set(position.x, position.y, position.z);
      const riser = anchor.getObjectByName('riser')!;
      const height = Math.max(.05, position.y + .03);
      riser.scale.y = height / riser.userData.height; riser.position.y = -height / 2;
    });
    scenery.layout(positions);
  }
  function resetCamera() {
    cameraTouched = false; cameraTime = 0;
    const minZ = Math.min(-2, ...positions.map(p => p.z - 1.6));
    const maxZ = Math.max(2, ...positions.map(p => p.z + 1.8));
    const center = (minZ + maxZ) / 2;
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const elevation = camera.aspect < 1 ? .32 : .19, sin = Math.sin(elevation), cos = Math.cos(elevation);
    let distance = 10;
    for (const position of positions) for (const y of [position.y - .2, position.y + 3]) for (const z of [position.z - 1.6, position.z + 1.8]) {
      const viewY = (y - 1.8) * cos - (z - center) * sin;
      const viewZ = (y - 1.8) * sin + (z - center) * cos;
      distance = Math.max(distance, viewZ + Math.max((Math.abs(position.x) + 1.6) / (tangent * camera.aspect), Math.abs(viewY) / tangent));
    }
    distance *= 1.08;
    camera.position.set(0, 1.8 + distance * sin, center + distance * cos);
    controls.target.set(0, 1.8, center); controls.update();
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height); composer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); layout(); resetCamera();
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
      performers.forEach(({ rig, instrument, target, anchor }, index) => {
        rig.resetPose();
        const motion = motions[index]!;
        animatePerformer(trackRole(snapshot.program.tracks[index]!), rig, options.reducedMotion ? { ...motion, playing: false, active: false, energy: 0 } : motion, instrument);
        target.copy(anchor.position).add(rig.body.position);
      });
      const signals = concertSignals(snapshot.program, motions, options.reducedMotion);
      const time = options.reducedMotion ? 0 : (motions[0]?.beat ?? 0) * 60 / (snapshot.state.tempo ?? snapshot.program.tempo);
      scenery.update(time, signals, performers.map(performer => performer.target));
      // Stop automatic moves as soon as the listener takes control.
      if (!cameraTouched && !options.reducedMotion && snapshot.state.playing) {
        const offset = Math.sin(time * .08) * .35;
        camera.position.x += offset - cameraTime; cameraTime = offset;
      }
      renderer.domElement.dataset.concert = 'true';
      renderer.domElement.dataset.chorus = String(signals.chorus);
      renderer.domElement.dataset.playing = String(snapshot.state.playing);
      renderer.domElement.dataset.beat = (motions[0]?.beat ?? 0).toFixed(3);
      controls.update(); composer.render();
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
      scenery.dispose(); bloom.dispose(); output.dispose(); renderPass.dispose(); composer.dispose(); key.shadow.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
