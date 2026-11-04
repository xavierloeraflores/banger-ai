import type { Group } from 'three';
import type { CharacterRig } from './character.js';
import type { PerformanceRole, TrackMotion } from './score.js';
import { createPercussion, animatePercussion, posePercussion, updatePercussionSticks } from './percussion.js';
import { createMelodicInstrument, animateMelodic } from './melodic.js';
import { PoseSmoother } from './pose.js';

export function createInstrument(role: PerformanceRole, rig: CharacterRig): Group {
  return role === 'drums' ? createPercussion(rig) : createMelodicInstrument(role, rig);
}
export function animatePerformer(role: PerformanceRole, rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  if (role === 'drums') animatePercussion(rig, motion, instrument);
  else animateMelodic(role, rig, motion, instrument);
}

/** One blend history per performer. Score sampling and audio remain immediate. */
export class PerformerAnimator {
  private readonly smoother;

  constructor(private readonly role: PerformanceRole, private readonly rig: CharacterRig, private readonly instrument: Group) {
    const nodes = [rig.body, rig.head, rig.leftArm, rig.rightArm, rig.leftLeg, rig.rightLeg];
    const guitar = instrument.getObjectByName('guitar');
    if (guitar) nodes.push(guitar as Group);
    this.smoother = new PoseSmoother(nodes);
  }

  update(motion: TrackMotion, deltaSeconds?: number): void {
    this.rig.resetPose();
    if (this.role === 'drums') posePercussion(this.rig, motion, this.instrument);
    else animateMelodic(this.role, this.rig, motion, this.instrument);
    const alpha = this.smoother.update(deltaSeconds);
    if (this.role === 'drums') updatePercussionSticks(this.rig, this.instrument, alpha);
  }
}
