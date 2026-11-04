import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, type ColorRepresentation } from 'three';
import type { CharacterRig } from './character.js';
import type { TrackMotion } from './score.js';
import type { PlayedRole } from './roles.js';
import { reachInstrument } from './pose.js';

const surface = (color: ColorRepresentation, metalness = 0) => new MeshStandardMaterial({ color, metalness, roughness: metalness ? .48 : .62 });
function box(parent: Group, name: string, size: [number, number, number], position: [number, number, number], material: MeshStandardMaterial) {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.name = name; mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function tube(parent: Group, name: string, start: number[], end: number[], radius: number, material: MeshStandardMaterial, tip = radius) {
  const a = new Vector3(...start), b = new Vector3(...end), direction = b.clone().sub(a);
  const mesh = new Mesh(new CylinderGeometry(tip, radius, direction.length(), 12), material);
  mesh.name = name; mesh.position.copy(a.add(b).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function oval(parent: Group, name: string, size: number[], position: number[], material: MeshStandardMaterial) {
  const mesh = new Mesh(new SphereGeometry(1, 16, 12), material);
  mesh.name = name; mesh.scale.set(...size as [number, number, number]); mesh.position.set(...position as [number, number, number]);
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function contact(parent: Group, name: string) { const node = new Group(); node.name = name; parent.add(node); return node; }

/** All props and moving parts remain in this tree, owned by the scene disposer. */
export function createPlayedInstrument(role: PlayedRole, rig: CharacterRig): Group {
  const instrument = new Group(); instrument.name = `${role}-instrument`; instrument.position.copy(rig.root.position);
  const prop = new Group(); prop.name = 'held-prop'; instrument.add(prop);
  const silver = surface('#d7d5e4', .75), dark = surface('#343047'), ivory = surface('#f3e8d7');
  const shell = rig.root.getObjectByName('hood-and-body') as Mesh;
  const paw = surface((shell.material as MeshStandardMaterial).color);
  if (role === 'brass') {
    const gold = surface('#cfaa5f', .72); gold.side = DoubleSide;
    tube(prop, 'mouthpiece', [0, 0, 0], [0, 0, .17], .026, silver);
    tube(prop, 'leadpipe', [0, 0, .17], [0, -.15, .39], .025, gold);
    tube(prop, 'bell-tube', [-.13, -.19, .08], [-.13, -.19, .56], .048, gold);
    const bell = new Mesh(new CylinderGeometry(.17, .048, .22, 20, 1, true), gold);
    bell.name = 'bell'; bell.rotation.x = Math.PI / 2; bell.position.set(-.13, -.19, .67); prop.add(bell);
    const rim = new Mesh(new TorusGeometry(.17, .012, 8, 24), gold); rim.position.set(-.13, -.19, .78); prop.add(rim);
    tube(prop, 'bell-shadow', [-.13, -.19, .55], [-.13, -.19, .56], .045, dark);
    const bend = new Mesh(new TorusGeometry(.12, .025, 8, 20, Math.PI), gold);
    bend.rotation.x = Math.PI / 2; bend.position.set(0, -.23, .13); prop.add(bend);
    for (let i = 0; i < 3; i++) {
      tube(prop, `valve-body-${i}`, [.13, -.25, .11 + i * .075], [.13, -.1, .11 + i * .075], .035, gold);
      const valve = contact(prop, `valve-${i}`); valve.position.set(.13, -.08, .11 + i * .075);
      tube(valve, 'stem', [0, -.04, 0], [0, 0, 0], .013, silver);
      oval(valve, 'cap', [.045, .013, .035], [0, 0, 0], ivory);
      oval(valve, 'fingertip', [.035, .025, .032], [0, .031, 0], paw);
    }
  } else if (role === 'flute') {
    tube(prop, 'flute-tube', [-.15, 0, .035], [1.03, 0, .035], .029, silver);
    oval(prop, 'lip-plate', [.065, .022, .045], [0, .006, .022], silver);
    oval(prop, 'embouchure', [.022, .008, .017], [0, .023, .018], dark);
    const keyPositions = [.01, .08, .15, .38, .47, .65, .72, .79];
    for (let i = 0; i < 8; i++) {
      const key = oval(prop, `flute-key-${i}`, [.027, .012, .038], [keyPositions[i]!, .035, .035], silver);
      if (i < 3 || i > 4) oval(prop, `finger-${i}`, [.026, .023, .03], [key.position.x, .066, .035], paw);
    }
    for (const x of [-.12, .14, .93]) tube(prop, 'flute-ring', [x, 0, .035], [x + .014, 0, .035], .035, silver);
  } else if (role === 'chiptune') {
    const casework = surface('#86759e'), mint = surface('#a6dccb');
    box(prop, 'retro-case', [.92, .18, .42], [0, 0, 0], casework);
    box(prop, 'display-frame', [.28, .015, .105], [-.22, .1, -.115], dark);
    box(prop, 'display', [.23, .017, .068], [-.22, .11, -.115], mint);
    for (let i = 0; i < 8; i++) box(prop, `chip-key-${i}`, [.095, .04, .24], [(i - 3.5) * .105, .11, .06], ivory);
    for (let i = 0; i < 3; i++) oval(prop, 'button', [.026, .017, .026], [.13 + i * .09, .108, -.12], mint);
  } else if (role === 'strings') {
    const violin = new Group(); violin.name = 'violin'; violin.rotation.z = .95; violin.position.set(-.25, -.08, 0); prop.add(violin);
    const wood = surface('#af744e'), trim = surface('#deb78a');
    oval(violin, 'lower-bout', [.21, .23, .07], [0, -.13, 0], wood);
    oval(violin, 'upper-bout', [.16, .18, .065], [0, .16, 0], wood);
    box(violin, 'waist', [.2, .19, .12], [0, .025, 0], wood);
    box(violin, 'neck', [.065, .43, .055], [0, .45, 0], trim);
    box(violin, 'fingerboard', [.07, .46, .025], [0, .36, .075], dark);
    oval(violin, 'scroll', [.07, .085, .055], [0, .72, 0], wood);
    box(violin, 'bridge', [.14, .027, .035], [0, -.04, .09], trim);
    oval(violin, 'chin-rest', [.095, .065, .025], [.1, -.23, .08], dark);
    for (const x of [-.11, .11]) {
      tube(violin, 'sound-hole', [x, -.09, .071], [x, .09, .071], .012, dark);
      for (const y of [.55, .64]) tube(violin, 'peg', [-.09, y, 0], [.09, y, 0], .02, dark);
    }
    for (let i = 0; i < 4; i++) tube(violin, 'string', [(i - 1.5) * .018, -.25, .112], [(i - 1.5) * .018, .65, .095], .0025, silver);
    const bow = new Group(); bow.name = 'bow'; prop.add(bow);
    tube(bow, 'bow-stick', [-.6, .035, 0], [.6, .035, 0], .012, wood);
    tube(bow, 'bow-hair', [-.59, 0, 0], [.57, 0, 0], .009, ivory);
    box(bow, 'frog', [.09, .065, .055], [.53, .016, 0], dark);
  } else if (role === 'kalimba') {
    const wood = surface('#b58c68');
    box(prop, 'kalimba-body', [.58, .14, .47], [0, 0, 0], wood);
    oval(prop, 'sound-hole', [.075, .008, .075], [0, .073, .07], dark);
    box(prop, 'bridge', [.49, .025, .035], [0, .1, -.12], silver);
    for (let i = 0; i < 9; i++) {
      const length = .29 - Math.abs(i - 4) * .027;
      const tine = box(prop, `tine-${i}`, [.035, .012, length], [(i - 4) * .05, .11, -.12 + length / 2], silver);
      tine.userData.restZ = tine.position.z;
    }
    for (const side of ['left', 'right']) oval(prop, `${side}-thumb`, [.045, .034, .075], [side === 'left' ? -.12 : .12, .16, .18], paw);
  } else {
    const casing = surface('#667a94'), light = surface('#9ad8cc'); light.emissive.set('#72bcbd');
    box(prop, 'controller', [.8, .18, .48], [0, 0, 0], casing);
    box(prop, 'slider-track', [.045, .012, .32], [.14, .1, 0], dark);
    box(prop, 'slider', [.13, .055, .065], [.14, .13, .14], ivory);
    for (let i = 0; i < 7; i++) box(prop, `sweep-led-${i}`, [.04, .017, .028], [-.19, .105, .14 - i * .045], light.clone());
    for (const x of [-.3, .31]) tube(prop, 'knob', [x, .08, -.14], [x, .14, -.14], .035, dark);
    light.dispose();
  }
  contact(prop, 'left-contact'); contact(prop, 'right-contact');
  // Only allocated materials attached to meshes are retained by scene ownership.
  const used = new Set<MeshStandardMaterial>(); instrument.traverse(node => { if (node instanceof Mesh) used.add(node.material as MeshStandardMaterial); });
  for (const material of [silver, dark, ivory, paw]) if (!used.has(material)) material.dispose();
  return instrument;
}

/** A score-time target, blended by the same smoother used for the existing band. */
export function animatePlayed(role: PlayedRole, rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  const prop = instrument.getObjectByName('held-prop') as Group;
  const active = motion.playing && motion.active;
  const age = active && Number.isFinite(motion.age) ? Math.max(0, motion.age) : 100;
  const strength = active ? Math.sqrt(Math.min(1, Math.max(0, motion.energy))) : 0;
  const press = Math.exp(-age * 20) * strength;
  const progress = active ? Math.min(1, age / Math.max(.005, motion.duration)) : 0;
  const index = motion.gestureIndex ?? motion.index, alternate = index % 2 === 0;
  const pitch = active ? ((motion.midi % 7) + 7) % 7 : 3;
  const left = prop.getObjectByName('left-contact')!, right = prop.getObjectByName('right-contact')!;
  prop.rotation.set(0, 0, 0);
  rig.head.rotation.x = role === 'brass' || role === 'flute' ? 0 : .07 * strength;
  if (role === 'brass') {
    prop.position.set(0, 2.015 - (active ? 0 : .23), .57);
    prop.rotation.x = active ? 0 : .25;
    left.position.set(-.22, -.24, .12); right.position.set(.21, -.09, .18);
    for (let i = 0; i < 3; i++) prop.getObjectByName(`valve-${i}`)!.position.y = -.08 - ((pitch + i) % 3 ? .035 * press : 0);
    right.position.y -= .025 * press;
  } else if (role === 'flute') {
    rig.head.rotation.y = -.26;
    prop.position.set(-.147, 2.015 - (active ? 0 : .24), .551);
    prop.rotation.z = active ? -.15 : -.4;
    // The near hand approaches from below; the tube runs across the face's right side.
    left.position.set(.08, -.08, .035); right.position.set(.72, -.065, .035);
    for (let i = 0; i < 8; i++) {
      const lift = active && (pitch + i) % 3 === 0 ? .013 * (.6 + .4 * Math.cos(age * 8)) : 0;
      prop.getObjectByName(`flute-key-${i}`)!.position.y = .035 + lift;
      const finger = prop.getObjectByName(`finger-${i}`); if (finger) finger.position.y = .066 + lift;
    }
  } else if (role === 'chiptune') {
    prop.position.set(0, 1.15, .77); prop.rotation.x = .12;
    const key = alternate ? pitch % 4 : 4 + pitch % 4;
    left.position.set(alternate && active ? (key - 3.5) * .105 : -.32, .19 - (alternate ? .055 * press : 0), .06);
    right.position.set(!alternate && active ? (key - 3.5) * .105 : .32, .19 - (!alternate ? .055 * press : 0), .06);
    for (let i = 0; i < 8; i++) prop.getObjectByName(`chip-key-${i}`)!.position.y = .11 - (i === key ? .025 * press : 0);
  } else if (role === 'strings') {
    prop.position.set(0, active ? 1.77 : 1.62, .72);
    const violin = prop.getObjectByName('violin') as Group;
    left.position.set(0, .47 + pitch * .008, .11).applyEuler(violin.rotation).add(violin.position);
    const bow = prop.getObjectByName('bow')!;
    // Slow alternating strokes remain continuous throughout held notes.
    const stroke = active ? Math.sin(age * 3.4 + (alternate ? 0 : Math.PI)) * .16 : .08;
    bow.position.set(-.18 + stroke, -.08, active ? .12 : .23);
    right.position.copy(bow.position).add(new Vector3(.53, .016, 0));
  } else if (role === 'kalimba') {
    prop.position.set(0, 1.2, .78); prop.rotation.x = .28;
    left.position.set(-.26, .02, .12); right.position.set(.26, .02, .12);
    for (const side of ['left', 'right']) {
      const pluck = (side === 'left') === alternate ? press : 0;
      const thumb = prop.getObjectByName(`${side}-thumb`)!;
      thumb.position.set(side === 'left' ? -.1 : .1, .16 - .04 * pluck, .18 - .08 * pluck);
      thumb.rotation.x = -.35 * pluck;
    }
    for (let i = 0; i < 9; i++) {
      const tine = prop.getObjectByName(`tine-${i}`)!;
      tine.rotation.x = i === (alternate ? 2 : 6) ? .1 * Math.sin(age * 75) * press : 0;
    }
  } else {
    prop.position.set(0, 1.2, .76); prop.rotation.x = .12;
    const slider = prop.getObjectByName('slider')!; slider.position.z = .14 - .28 * progress;
    left.position.set(-.34, .03, .04); right.position.set(.14, .18, slider.position.z);
    for (let i = 0; i < 7; i++) {
      const led = prop.getObjectByName(`sweep-led-${i}`) as Mesh;
      (led.material as MeshStandardMaterial).emissiveIntensity = active && progress >= i / 7 ? 1.2 : .05;
    }
  }
  reachInstrument(rig, 'left', prop, left.position.x, left.position.y, left.position.z, .78);
  reachInstrument(rig, 'right', prop, right.position.x, right.position.y, right.position.z, .78);
}
