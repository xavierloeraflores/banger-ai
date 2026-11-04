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
  if (role === 'musicBox') {
    box(prop, 'music-box-base', [.78, .14, .5], [0, -.08, 0], wood);
    for (const x of [-.38, .38]) box(prop, 'box-wall', [.045, .2, .5], [x, .04, 0], wood);
    box(prop, 'front-wall', [.78, .12, .035], [0, .01, .24], wood);
    const lid = new Group(); lid.name = 'open-lid'; lid.position.set(0, .06, -.24); lid.rotation.x = .95; prop.add(lid);
    box(lid, 'lid-panel', [.8, .045, .48], [0, 0, -.24], wood);
    box(lid, 'lid-inlay', [.6, .012, .3], [0, .03, -.24], amber);
    const cylinder = new Group(); cylinder.name = 'pinned-cylinder'; cylinder.position.set(0, .14, -.055); prop.add(cylinder);
    const drum = new Mesh(new CylinderGeometry(.09, .09, .55, 20), amber); drum.rotation.z = Math.PI / 2; cylinder.add(drum);
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.4;
      box(cylinder, 'cylinder-pin', [.012, .025, .025], [(i % 12 - 5.5) * .043, Math.cos(angle) * .09, Math.sin(angle) * .09], silver);
    }
    for (let i = 0; i < 12; i++) box(prop, `comb-tine-${i}`, [.029, .012, .12 + i * .004], [(i - 5.5) * .043, .13, .12], silver);
    const crank = new Group(); crank.name = 'music-box-crank'; crank.position.set(.44, .14, -.055); prop.add(crank);
    box(crank, 'crank-arm', [.025, .14, .025], [0, -.07, 0], amber);
    box(crank, 'crank-handle', [.08, .035, .035], [.04, -.14, 0], wood);
    box(prop, 'pedestal', [.14, .9, .14], [0, -.6, 0], dark);
    box(prop, 'pedestal-foot', [.55, .06, .4], [0, -1.05, 0], dark);
  } else if (role === 'clavinet') {
    box(prop, 'clavinet-case', [1.38, .18, .55], [0, -.04, 0], wood);
    box(prop, 'clavinet-top', [1.25, .04, .18], [0, .07, -.18], dark);
    // Two chromatic octaves. Each key is addressable by semitone, including black keys.
    const whitePitch = [0, 2, 4, 5, 7, 9, 11];
    for (let midi = 0; midi <= 24; midi++) {
      const pc = midi % 12, octave = Math.floor(midi / 12);
      const white = whitePitch.includes(pc);
      const index = octave * 7 + (white ? whitePitch.indexOf(pc) : whitePitch.findIndex(pitch => pitch > pc) - .5);
      const key = box(prop, `clav-key-${midi}`, [white ? .077 : .045, white ? .035 : .045, white ? .32 : .18], [(index - 7) * .082, white ? .072 : .112, white ? .065 : -.005], white ? silver : dark);
      key.userData.restY = key.position.y;
    }
    for (let i = 0; i < 4; i++) box(prop, `clav-switch-${i}`, [.055, .025, .045], [-.48 + i * .09, .105, -.2], amber);
    for (const x of [-.53, .53]) {
      box(prop, 'clav-leg', [.045, 1.04, .045], [x, -.65, 0], silver);
      box(prop, 'clav-foot', [.26, .035, .36], [x, -1.17, 0], dark);
    }
  } else if (role === 'marimba' || role === 'woodblock') {
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
      for (let i = 0; i < 4; i++) box(prop, `bass-light-${i}`, [.08, .012, .02], [-.29 + i % 2 * .18, .125, -.16 + Math.floor(i / 2) * .18], material('#f17247'));
      for (let i = 0; i < 3; i++) {
        const knob = new Mesh(new CylinderGeometry(.027, .027, .035, 12), dark);
        knob.position.set(.09, .1, -.13 + i * .12); prop.add(knob);
      }
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
  const notes = motion.playing ? motion.notes ?? (active ? [{ midi: motion.midi, pitchDecay: .035, age, duration: motion.duration, energy: motion.energy, level: 1 }] : []) : [];
  if (role === 'musicBox') {
    prop.rotation.x = .12;
    const sounding = notes.filter(note => note.level > .001 || note.age === 0);
    const latest = sounding.reduce<(typeof notes)[number] | undefined>((last, note) => !last || note.age < last.age ? note : last, undefined);
    const rotation = latest ? latest.age * 7 : 0;
    prop.getObjectByName('pinned-cylinder')!.rotation.x = rotation;
    const crank = prop.getObjectByName('music-box-crank')!; crank.rotation.x = rotation;
    for (let i = 0; i < 12; i++) {
      const note = sounding.filter(note => note.midi % 12 === i).reduce<(typeof notes)[number] | undefined>((last, note) => !last || note.age < last.age ? note : last, undefined);
      prop.getObjectByName(`comb-tine-${i}`)!.rotation.x = note ? Math.sin(note.age * 90 + .8) * .22 * Math.exp(-note.age * 8) * note.energy : 0;
    }
    left.position.set(-.35, .12, .16);
    right.position.set(.48, .14 - Math.cos(rotation) * .14, -.055 - Math.sin(rotation) * .14);
  } else if (role === 'clavinet') {
    prop.position.z = .8; prop.rotation.x = 0;
    const keyIndex = (midi: number) => midi >= 48 && midi <= 72 ? midi - 48 : ((midi - 48) % 24 + 24) % 24;
    const held = notes.filter(note => note.age < note.duration);
    const keys = [...new Set(held.map(note => keyIndex(note.midi)))].sort((a, b) => a - b);
    for (let i = 0; i <= 24; i++) {
      const key = prop.getObjectByName(`clav-key-${i}`)!;
      key.position.y = key.userData.restY - (keys.includes(i) ? .025 : 0);
    }
    for (const [side, contact, index] of [['left', left, keys[0] ?? 5], ['right', right, keys.at(-1) ?? 17]] as const) {
      const key = prop.getObjectByName(`clav-key-${index}`)!;
      // Mitten-sized hands cover the outer voices of the chord; every key follows its own gate.
      const x = keys.length === 1 ? key.position.x + (side === 'left' ? -.07 : .07) : key.position.x;
      contact.position.set(side === 'left' ? Math.min(-.12, x) : Math.max(.12, x), key.position.y + (keys.length ? .06 : .16), .07);
    }
  } else if (role === 'marimba' || role === 'woodblock') {
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
    const sounding = notes.filter(note => note.level > .001 || note.age === 0);
    const latest = sounding.reduce<(typeof notes)[number] | undefined>((last, note) => !last || note.age < last.age ? note : last, undefined);
    const pad = latest ? latest.midi % 4 : 0;
    const pulse = latest ? Math.exp(-latest.age * 24) * Math.sqrt(latest.energy) : 0;
    left.position.set(latest ? -.29 + pad % 2 * .18 : -.29, .2 - .055 * pulse, latest ? -.1 + Math.floor(pad / 2) * .18 : .04);
    const cursor = prop.getObjectByName('pitch-cursor')!;
    cursor.position.z = latest ? -.12 + .24 * Math.min(1, latest.age / latest.pitchDecay) : 0;
    right.position.set(.33, .18, cursor.position.z);
    for (let i = 0; i < 4; i++) {
      prop.getObjectByName(`bass-pad-${i}`)!.position.y = .1 - (i === pad ? .025 * pulse : 0);
      const light = prop.getObjectByName(`bass-light-${i}`) as Mesh<BoxGeometry, MeshStandardMaterial>;
      light.material.emissive.set('#ff542b');
      light.material.emissiveIntensity = Math.max(0, ...sounding.filter(note => note.midi % 4 === i).map(note => note.level * note.energy * 2));
    }
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
