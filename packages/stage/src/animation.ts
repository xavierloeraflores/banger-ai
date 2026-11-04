import type { Group } from 'three';
import type { CharacterRig } from './character.js';
import type { PerformanceRole, TrackMotion } from './score.js';
import { createPercussion, animatePercussion, posePercussion, updatePercussionSticks } from './percussion.js';
import { createMelodicInstrument, animateMelodic } from './melodic.js';
import { PoseSmoother } from './pose.js';
import { animatePlayed, createPlayedInstrument } from './played.js';
import { playedRoles, type PlayedRole } from './roles.js';

export function createInstrument(role: PerformanceRole, rig: CharacterRig): Group {
  if (playedRoles.includes(role)) return createPlayedInstrument(role as PlayedRole, rig);
  return role === 'drums' ? createPercussion(rig) : createMelodicInstrument(role as 'bass' | 'keys' | 'dance', rig);
}
export function animatePerformer(role: PerformanceRole, rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  if (role === 'drums') animatePercussion(rig, motion, instrument);
  else if (playedRoles.includes(role)) animatePlayed(role as PlayedRole, rig, motion, instrument);
  else animateMelodic(role as 'bass' | 'keys' | 'dance', rig, motion, instrument);
}

/** One blend history per performer. Score sampling and audio remain immediate. */
export class PerformerAnimator {
  private readonly smoother;
  private readonly propSmoother;

  constructor(private readonly role: PerformanceRole, private readonly rig: CharacterRig, private readonly instrument: Group, blendFromCurrent = false) {
    const nodes = [rig.body, rig.head, rig.leftArm, rig.rightArm, rig.leftLeg, rig.rightLeg];
    this.smoother = new PoseSmoother(nodes);
    if (blendFromCurrent) this.smoother.update(0);
    const props: Group[] = [];
    const guitar = instrument.getObjectByName('guitar');
    if (guitar) props.push(guitar as Group);
    instrument.traverse(node => { if (['held-prop', 'bow', 'slider'].includes(node.name)) props.push(node as Group); });
    this.propSmoother = new PoseSmoother(props);
  }

  update(motion: TrackMotion, deltaSeconds?: number): void {
    this.rig.resetPose();
    if (this.role === 'drums') posePercussion(this.rig, motion, this.instrument);
    else animatePerformer(this.role, this.rig, motion, this.instrument);
    const alpha = this.smoother.update(deltaSeconds);
    this.propSmoother.update(deltaSeconds);
    if (this.role === 'drums') updatePercussionSticks(this.rig, this.instrument, alpha);
  }
}
