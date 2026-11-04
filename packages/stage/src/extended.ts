import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { CharacterRig } from './character.js';
import type { TrackMotion } from './score.js';
import type { ExtendedRole } from './roles.js';
import { reachInstrument } from './pose.js';

const material = (color: string, metalness = 0) => new MeshStandardMaterial({ color, metalness, roughness: .55 });
function box(parent: Group, name: string, size: [number, number, number], position: [number, number, number], surface: MeshStandardMaterial) {
  const mesh = new Mesh(new BoxGeometry(...size), surface);
  mesh.name = name; mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function mallet(parent: Group, side: string, wood: MeshStandardMaterial, head: MeshStandardMaterial) {
  const group = new Group(); group.name = `${side}-mallet`; parent.add(group);
  const shaft = new Mesh(new CylinderGeometry(.013, .013, .25, 8), wood);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = .125; group.add(shaft);
  const tip = new Mesh(new SphereGeometry(.05, 12, 8), head); tip.position.z = .25; group.add(tip);
  return group;
}

/** Procedural assets remain under the instrument root for normal scene disposal. */
export function createExtendedInstrument(role: ExtendedRole, rig: CharacterRig): Group {
  const instrument = new Group(); instrument.name = `${role}-instrument`; instrument.position.copy(rig.root.position);
  const prop = new Group(); prop.name = 'held-prop'; instrument.add(prop);
  const wood = material('#b57c4e'), dark = material('#30364b'), silver = material('#d3dce8', .6), blue = material('#577eac'), amber = material('#edb665');
  if (role === 'marimba' || role === 'woodblock') {
    box(prop, 'frame', [1.02, .09, .43], [0, -.06, 0], dark);
    for (const x of [-.43, .43]) {
      box(prop, 'stand-leg', [.045, 1.03, .045], [x, -.62, 0], silver);
      box(prop, 'stand-foot', [.25, .035, .4], [x, -1.12, 0], dark);
    }
    if (role === 'marimba') {
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * .135, length = .4 - i * .025;
        box(prop, `bar-${i}`, [.115, .055, length], [x, .025, 0], wood);
        const resonator = new Mesh(new CylinderGeometry(.037, .037, .24 - i * .02, 8), silver);
        resonator.position.set(x, -.15, 0); prop.add(resonator);
      }
    } else {
      box(prop, 'woodblock', [.58, .18, .3], [0, .045, 0], wood);
      box(prop, 'slot', [.45, .018, .008], [0, .06, .154], dark);
    }
    mallet(prop, 'left', wood, amber); mallet(prop, 'right', wood, amber);
  } else if (role === 'mutedGuitar') {
    const body = new Mesh(new SphereGeometry(1, 20, 14), blue); body.scale.set(.27, .33, .07); body.position.y = -.12; prop.add(body);
    box(prop, 'neck', [.12, .65, .06], [0, .48, 0], wood);
    box(prop, 'fingerboard', [.1, .65, .015], [0, .48, .04], dark);
    box(prop, 'headstock', [.16, .17, .07], [0, .88, 0], wood);
    box(prop, 'bridge', [.18, .045, .025], [0, -.23, .08], silver);
    box(prop, 'pickup', [.18, .055, .03], [0, -.02, .08], dark);
    for (let i = 0; i < 6; i++) {
      box(prop, `string-${i}`, [.003, 1.06, .003], [(i - 2.5) * .016, .28, .098], silver);
      box(prop, `tuner-${i}`, [.05, .025, .03], [i % 2 ? .1 : -.1, .83 + Math.floor(i / 2) * .045, 0], silver);
    }
    for (let i = 0; i < 7; i++) box(prop, 'fret', [.1, .006, .005], [0, .21 + i * .08, .055], silver);
    box(prop, 'mute-pad', [.19, .045, .045], [0, -.18, .12], amber);
  } else {
    box(prop, 'controller', [.88, .16, .45], [0, 0, 0], blue);
    if (role === 'bass808') {
      for (let i = 0; i < 4; i++) box(prop, `bass-pad-${i}`, [.135, .04, .15], [-.29 + i % 2 * .18, .1, -.1 + Math.floor(i / 2) * .18], amber);
      box(prop, 'pitch-ribbon', [.045, .012, .3], [.33, .09, 0], dark);
      box(prop, 'pitch-cursor', [.07, .02, .035], [.33, .11, 0], silver);
    } else if (role === 'impact') {
      box(prop, 'impact-pad', [.48, .06, .29], [0, .11, .02], amber);
      box(prop, 'impact-light', [.52, .016, .035], [0, .09, -.17], silver);
    } else {
      box(prop, 'slider-track', [.055, .015, .33], [.16, .09, 0], dark);
      box(prop, 'slider', [.15, .05, .06], [.16, .12, -.15], silver);
      for (let i = 0; i < 6; i++) box(prop, `level-${i}`, [.13, .02, .025], [-.19, .1, -.14 + i * .05], amber);
    }
  }
  for (const side of ['left', 'right']) { const contact = new Group(); contact.name = `${side}-contact`; prop.add(contact); }
  const used = new Set(); instrument.traverse(node => { if (node instanceof Mesh) used.add(node.material); });
  for (const surface of [wood, dark, silver, blue, amber]) if (!used.has(surface)) surface.dispose();
  return instrument;
}

/** Gestures use note age and duration so seeking and looping reproduce the pose. */
export function animateExtended(role: ExtendedRole, rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  const prop = instrument.getObjectByName('held-prop')!;
  const active = motion.playing && motion.active;
  const age = active && Number.isFinite(motion.age) ? Math.max(0, motion.age) : 100;
  const strength = active ? Math.sqrt(Math.max(0, Math.min(1, motion.energy))) : 0;
  const hit = Math.exp(-age * 24) * strength;
  const progress = active ? Math.min(1, age / Math.max(.005, motion.duration)) : 0;
  const alternate = (motion.gestureIndex ?? motion.index) % 2 === 0;
  const pitch = ((motion.midi % 7) + 7) % 7;
  const left = prop.getObjectByName('left-contact')!, right = prop.getObjectByName('right-contact')!;
  prop.position.set(0, 1.14, .72); prop.rotation.set(.12, 0, 0);
  rig.head.rotation.x = .08 * strength;
  if (role === 'marimba' || role === 'woodblock') {
    prop.rotation.x = 0; prop.position.z = .82;
    for (const side of ['left', 'right']) {
      const selected = (side === 'left') === alternate;
      const mallet = prop.getObjectByName(`${side}-mallet`)!;
      const x = role === 'marimba' && selected && active ? (pitch % 4 - (side === 'left' ? 3 : 0)) * .135 : side === 'left' ? -.22 : .22;
      const y = (role === 'woodblock' ? .26 : .18) + .14 * (1 - (selected ? hit : 0));
      mallet.position.set(x, y, -.25); mallet.rotation.x = selected ? .28 * hit : 0;
      (side === 'left' ? left : right).position.copy(mallet.position);
    }
  } else if (role === 'mutedGuitar') {
    prop.position.set(-.13, 1.15, .67); prop.rotation.set(0, 0, -.65);
    left.position.set(-.07 + .16 * hit, -.15, .17);
    right.position.set(0, .42 + .025 * pitch, .1);
    prop.getObjectByName('mute-pad')!.position.z = .12 + .035 * (1 - hit);
  } else if (role === 'bass808') {
    const pad = pitch % 4;
    left.position.set(active ? -.29 + pad % 2 * .18 : -.29, .2 - .055 * hit, active ? -.1 + Math.floor(pad / 2) * .18 : .04);
    const cursor = prop.getObjectByName('pitch-cursor')!;
    cursor.position.z = active ? -.12 + .24 * Math.min(1, age / .12) : 0;
    right.position.set(.33, .18, cursor.position.z);
    for (let i = 0; i < 4; i++) prop.getObjectByName(`bass-pad-${i}`)!.position.y = .1 - (i === pad ? .025 * hit : 0);
  } else if (role === 'impact') {
    left.position.set(-.35, .08, .04); right.position.set(.06, .24 - .09 * hit, .02);
    prop.getObjectByName('impact-pad')!.position.y = .11 - .035 * hit;
    prop.getObjectByName('impact-light')!.scale.x = 1 + .2 * hit;
  } else {
    const slider = prop.getObjectByName('slider')!; slider.position.z = -.15 + .3 * progress;
    left.position.set(-.34, .06, .03); right.position.set(.16, .17, slider.position.z);
    for (let i = 0; i < 6; i++) prop.getObjectByName(`level-${i}`)!.scale.x = active && i / 6 >= progress ? 1 : .25;
  }
  for (const [side, contact] of [['left', left], ['right', right]] as const) {
    reachInstrument(rig, side, prop as Group, contact.position.x, contact.position.y, contact.position.z, .78);
  }
}
