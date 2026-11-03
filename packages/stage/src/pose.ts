import { Vector3, type Group } from 'three';
import type { CharacterRig } from './character.js';

const destination = new Vector3();
const direction = new Vector3();
const restDirection = new Vector3();

/** Aim a mitten's end at an instrument contact point, with a small plush stretch. */
export function reachInstrument(rig: CharacterRig, side: 'left' | 'right', reference: Group, x: number, y: number, z: number): void {
  const arm = side === 'left' ? rig.leftArm : rig.rightArm;
  const hand = side === 'left' ? rig.sockets.leftHand : rig.sockets.rightHand;
  reference.updateWorldMatrix(true, false);
  rig.body.updateWorldMatrix(true, false);
  destination.set(x, y, z);
  reference.localToWorld(destination);
  rig.body.worldToLocal(destination);
  direction.subVectors(destination, arm.position);
  const reach = direction.length();
  restDirection.copy(hand.position);
  arm.scale.setScalar(Math.min(1.13, Math.max(1, reach / restDirection.length())));
  arm.quaternion.setFromUnitVectors(restDirection.normalize(), direction.normalize());
}
