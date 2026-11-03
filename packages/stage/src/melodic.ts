import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type ColorRepresentation } from 'three';
import type { CharacterRig } from './character.js';
import type { TrackMotion } from './score.js';

type MelodicRole = 'bass' | 'keys' | 'dance';

function surface(color: ColorRepresentation, metalness = 0) {
  return new MeshStandardMaterial({ color, roughness: metalness ? .35 : .65, metalness });
}
function box(parent: Group, size: [number, number, number], position: [number, number, number], material: MeshStandardMaterial) {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

/** Props stay beneath the returned group so the stage owns their GPU lifetime. */
export function createMelodicInstrument(role: MelodicRole, rig: CharacterRig): Group {
  const instrument = new Group(); instrument.name = `${role}-instrument`;
  // The avatar origin is also the instrument origin, without reparenting its sockets.
  instrument.position.copy(rig.root.position);
  if (role === 'bass') {
    const guitar = new Group(); guitar.name = 'guitar'; guitar.position.set(-.22, 1.02, .76); guitar.rotation.z = -.67;
    const lacquer = surface('#835f9f'), edge = surface('#c1a6d6'), wood = surface('#d7b98b'), dark = surface('#393441'), metal = surface('#dad1df', .7);
    for (const [x, y, width, height] of [[0, -.1, .31, .34], [0, .19, .235, .24]] as const) {
      const body = new Mesh(new SphereGeometry(1, 28, 20), lacquer); body.scale.set(width, height, .095); body.position.set(x, y, 0); body.castShadow = true; guitar.add(body);
    }
    box(guitar, [.12, .86, .065], [0, .69, 0], wood);
    box(guitar, [.105, .83, .012], [0, .69, .04], dark);
    box(guitar, [.17, .24, .075], [0, 1.22, 0], wood);
    box(guitar, [.20, .045, .03], [0, -.21, .10], metal);
    box(guitar, [.20, .055, .025], [0, .06, .10], dark);
    for (let i = 0; i < 4; i++) {
      box(guitar, [.006, 1.37, .006], [(i - 1.5) * .025, .46, .108], metal);
      const tuner = new Mesh(new SphereGeometry(.025, 8, 6), metal); tuner.position.set(i % 2 ? .11 : -.11, 1.16 + Math.floor(i / 2) * .11, 0); guitar.add(tuner);
    }
    for (let i = 0; i < 8; i++) box(guitar, [.11, .009, .009], [0, .33 + i * .09, .055], edge);
    const strap = box(guitar, [.065, 1.05, .025], [-.19, .32, -.12], dark); strap.rotation.z = -.18;
    instrument.add(guitar);
  } else if (role === 'keys') {
    const casing = surface('#77718e'), white = surface('#f4eff6'), black = surface('#302d3e'), legs = surface('#898293', .5);
    const keyboard = new Group(); keyboard.name = 'keyboard'; keyboard.position.set(0, .98, .88);
    box(keyboard, [1.85, .16, .58], [0, 0, 0], casing);
    for (let i = 0; i < 14; i++) {
      const key = box(keyboard, [.119, .035, .4], [(i - 6.5) * .125, .097, .055], white);
      key.name = `key-${i}`;
      if (![2, 6].includes(i % 7) && i < 13) box(keyboard, [.073, .042, .23], [(i - 6) * .125, .135, -.03], black);
    }
    for (const side of [-1, 1]) {
      const leg = box(instrument, [.055, .91, .06], [side * .56, .46, .88], legs); leg.rotation.z = side * .3;
      box(instrument, [.5, .05, .33], [side * .69, .025, .88], legs);
    }
    instrument.add(keyboard);
  } else {
    // A tiny microphone gives the lead/pad dancer a stage role without hiding its face.
    const stand = surface('#736b86', .55), microphone = surface('#c2b8cf', .5);
    const pole = new Mesh(new CylinderGeometry(.018, .018, 1.32, 12), stand); pole.position.set(.9, .66, .45); instrument.add(pole);
    const base = new Mesh(new CylinderGeometry(.17, .19, .04, 24), stand); base.position.set(.9, .02, .45); instrument.add(base);
    const mic = new Mesh(new SphereGeometry(1, 16, 12), microphone); mic.scale.set(.065, .11, .065); mic.rotation.z = -.4; mic.position.set(.87, 1.39, .45); instrument.add(mic);
  }
  return instrument;
}

/** Pure score-time poses stay in sync after seeks, loops and background tab resumes. */
export function animateMelodic(role: MelodicRole, rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  const energy = motion.playing ? Math.sqrt(Math.min(1, Math.max(0, motion.energy))) : 0;
  const phase = motion.beat * Math.PI * 2;
  const age = Number.isFinite(motion.age) ? Math.max(0, motion.age) : 100;
  const attack = Math.exp(-age * 14) * energy;
  const pitch = Math.max(-1, Math.min(1, (motion.midi - 60) / 24));
  const sway = Math.sin(phase / 4 + motion.index * .12) * energy;
  rig.head.rotation.z = -.06 * sway;
  rig.head.rotation.x = -.045 * energy + .08 * attack;
  rig.body.rotation.z = .035 * sway;
  rig.body.position.y += .035 * energy * (1 - Math.cos(phase));
  rig.leftLeg.rotation.x = .08 * Math.max(0, Math.sin(phase / 2)) * energy;
  rig.rightLeg.rotation.x = .08 * Math.max(0, -Math.sin(phase / 2)) * energy;

  if (role === 'bass') {
    // Left paw plucks the body while the right paw follows pitches along the neck.
    rig.leftArm.rotation.set(-1.05 - .27 * attack, 0, .56 + .14 * attack);
    rig.rightArm.rotation.set(-1.67 - .14 * pitch * energy, -.06, -.8 + .1 * pitch * energy);
    const guitar = instrument.getObjectByName('guitar');
    if (guitar) { guitar.rotation.z = -.67 + .035 * sway; guitar.position.y = 1.02 + .025 * energy * (1 - Math.cos(phase)); }
  } else if (role === 'keys') {
    const alternate = motion.index % 2 === 0;
    rig.leftArm.rotation.set(-1.02 - (alternate ? .2 : .07) * attack, .1 * pitch * energy, .2 + .12 * pitch * energy);
    rig.rightArm.rotation.set(-1.02 - (alternate ? .07 : .2) * attack, .1 * pitch * energy, -.2 + .12 * pitch * energy);
    const keyboard = instrument.getObjectByName('keyboard');
    if (keyboard) for (let i = 0; i < 14; i++) {
      const key = keyboard.getObjectByName(`key-${i}`);
      if (key) key.position.y = .097 - (i === ((motion.midi % 14) + 14) % 14 && motion.active ? .018 * energy : 0);
    }
  } else {
    const lift = energy * (.45 + .25 * Math.sin(phase / 4));
    rig.leftArm.rotation.set(-.25 * energy - .3 * attack, 0, -.25 * energy - lift);
    rig.rightArm.rotation.set(-.25 * energy - .3 * attack, 0, .25 * energy + lift);
    rig.body.rotation.y = .16 * sway;
    rig.body.rotation.z = .1 * sway;
    rig.head.rotation.y = -.12 * sway;
    rig.leftLeg.rotation.z = -.05 * energy;
    rig.rightLeg.rotation.z = .05 * energy;
  }
}
