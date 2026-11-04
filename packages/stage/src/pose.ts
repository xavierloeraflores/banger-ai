import { Vector3, type Group, type Object3D } from 'three';
import type { CharacterRig } from './character.js';

const destination = new Vector3();
const direction = new Vector3();
const restDirection = new Vector3();

/** Time-based damping, reaching 95% of a new pose in about 165 ms.
 * Cap elapsed time so dropped frames and tab resumes cannot teleport the rig.
 */
export function poseBlendAlpha(deltaSeconds: number): number {
  return 1 - Math.exp(-Math.min(.05, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0)) / .055);
}

/** Stores the displayed pose independently of the next score-time target. */
export class PoseSmoother {
  private initialized = false;
  private readonly poses;

  constructor(nodes: Object3D[]) {
    this.poses = nodes.map(node => ({ node, position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone() }));
  }

  update(deltaSeconds?: number): number {
    // New performers and reduced motion adopt their first target immediately.
    const alpha = !this.initialized || deltaSeconds === undefined ? 1 : poseBlendAlpha(deltaSeconds);
    this.initialized = true;
    for (const pose of this.poses) {
      pose.position.lerp(pose.node.position, alpha);
      pose.rotation.slerp(pose.node.quaternion, alpha);
      pose.scale.lerp(pose.node.scale, alpha);
      pose.node.position.copy(pose.position);
      pose.node.quaternion.copy(pose.rotation);
      pose.node.scale.copy(pose.scale);
    }
    return alpha;
  }
}

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
