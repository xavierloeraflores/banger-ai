import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three';
import type { CharacterRig } from './character.js';
import type { TrackMotion } from './score.js';

interface PercussionParts {
  sticks: [Mesh, Mesh];
  cymbal: Mesh;
  hand: Vector3;
  target: Vector3;
  direction: Vector3;
}
const parts = new WeakMap<Group, PercussionParts>();
const up = new Vector3(0, 1, 0);

/** Instruments stay in this group, so the scene owns every prop's GPU resources. */
export function createPercussion(rig: CharacterRig): Group {
  const group = new Group(); group.name = 'percussion';
  const shell = new MeshStandardMaterial({ color: '#b6a4cf', roughness: .48, metalness: .1 });
  const chrome = new MeshStandardMaterial({ color: '#c9c4d2', roughness: .32, metalness: .7 });
  const head = new MeshStandardMaterial({ color: '#fff5e5', roughness: .85 });
  const wood = new MeshStandardMaterial({ color: '#bd9166', roughness: .8 });
  const gold = new MeshStandardMaterial({ color: '#d3af66', roughness: .4, metalness: .65 });
  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  add(new Mesh(new CylinderGeometry(.52, .52, .25, 40), shell), 0, .86, .85);
  add(new Mesh(new CylinderGeometry(.505, .505, .025, 40), head), 0, .997, .85);
  for (const y of [.735, .99]) {
    const rim = add(new Mesh(new TorusGeometry(.52, .022, 8, 40), chrome), 0, y, .85);
    rim.rotation.x = Math.PI / 2;
  }
  for (const x of [-.38, .38]) {
    const leg = add(new Mesh(new CylinderGeometry(.019, .019, .64, 8), chrome), x, .39, .85);
    leg.rotation.z = x > 0 ? -.17 : .17;
  }
  add(new Mesh(new CylinderGeometry(.025, .025, 1.15, 10), chrome), .81, .575, .63);
  add(new Mesh(new CylinderGeometry(.24, .27, .028, 32), chrome), .81, .018, .63);
  const cymbal = add(new Mesh(new CylinderGeometry(.31, .33, .028, 40), gold), .81, 1.17, .63);
  add(new Mesh(new CylinderGeometry(.07, .12, .045, 24), gold), .81, 1.2, .63);
  const stickGeometry = new CylinderGeometry(.016, .021, 1, 8);
  const sticks: [Mesh, Mesh] = [new Mesh(stickGeometry, wood), new Mesh(stickGeometry, wood)];
  sticks.forEach(stick => { stick.name = 'drumstick'; stick.castShadow = true; group.add(stick); });
  parts.set(group, { sticks, cymbal, hand: new Vector3(), target: new Vector3(), direction: new Vector3() });
  animatePercussion(rig, { beat: 0, playing: false, active: false, energy: 0, age: Infinity, duration: 0, midi: 60, index: 0 }, group);
  return group;
}

/** A note lands first, then the striking arm rebounds over the following 180 ms. */
export function animatePercussion(rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  const state = parts.get(instrument);
  if (!state) return;
  const energy = motion.playing ? Math.sqrt(Math.max(0, Math.min(1, motion.energy))) : 0;
  const age = Number.isFinite(motion.age) ? Math.max(0, motion.age) : 100;
  const impact = energy * Math.exp(-age * 9);
  const rebound = energy * Math.sin(Math.min(1, age / .18) * Math.PI);
  const left = motion.index % 2 === 0;
  rig.leftArm.rotation.set(-1.02 + (left ? .35 * impact - .28 * rebound : -.05 * impact), 0, .49);
  rig.rightArm.rotation.set(-1.02 + (!left ? .35 * impact - .28 * rebound : -.05 * impact), 0, -.49);
  rig.body.position.y -= impact * .045;
  rig.body.rotation.z = (left ? 1 : -1) * impact * .035;
  rig.head.rotation.x = impact * .11;
  rig.head.rotation.z = -rig.body.rotation.z * .6;
  rig.rightLeg.rotation.x = -impact * .1;
  state.cymbal.rotation.z = energy * Math.sin(age * 62) * .045;
  rig.root.updateWorldMatrix(true, true);
  instrument.updateWorldMatrix(true, false);
  const sockets = [rig.sockets.leftHand, rig.sockets.rightHand];
  for (let index = 0; index < 2; index++) {
    const socket = sockets[index]!;
    socket.getWorldPosition(state.hand); instrument.worldToLocal(state.hand);
    const striking = index === (left ? 0 : 1);
    state.target.set(index === 0 ? -.18 : .18, 1.035 + (striking ? .18 * rebound : .08), .95);
    state.direction.subVectors(state.target, state.hand);
    const length = state.direction.length();
    const stick = state.sticks[index]!;
    stick.position.copy(state.hand).addScaledVector(state.direction, .5);
    stick.quaternion.setFromUnitVectors(up, state.direction.normalize());
    stick.scale.set(1, Math.max(.01, length), 1);
  }
}
