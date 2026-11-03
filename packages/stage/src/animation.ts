import type { Group } from 'three';
import type { CharacterRig } from './character.js';
import type { PerformanceRole, TrackMotion } from './score.js';
import { createPercussion, animatePercussion } from './percussion.js';
import { createMelodicInstrument, animateMelodic } from './melodic.js';

export function createInstrument(role: PerformanceRole, rig: CharacterRig): Group {
  return role === 'drums' ? createPercussion(rig) : createMelodicInstrument(role, rig);
}
export function animatePerformer(role: PerformanceRole, rig: CharacterRig, motion: TrackMotion, instrument: Group): void {
  if (role === 'drums') animatePercussion(rig, motion, instrument);
  else animateMelodic(role, rig, motion, instrument);
}
