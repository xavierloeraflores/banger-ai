import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { CharacterRig } from './character.js';
import { PoseSmoother } from './pose.js';

export interface VocalWord { word: string; startMs: number; endMs: number }
/** A second input alongside the score, measured against the recording, never looped. */
export interface VocalPerformance { words: readonly VocalWord[]; positionMs: number; playing: boolean }
export class VocalScore {
  private source?: readonly VocalWord[];
  private words: VocalWord[] = [];
  sample(vocals?: VocalPerformance) {
    if (vocals?.words !== this.source) {
      this.source = vocals?.words;
      this.words = (vocals?.words ?? []).filter(word => word.word.trim() && Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.startMs >= 0 && word.endMs > word.startMs).slice().sort((a, b) => a.startMs - b.startMs);
    }
    const time = vocals?.positionMs ?? 0;
    const word = vocals?.playing && Number.isFinite(time) ? this.words.findLast(word => word.startMs <= time && time < word.endMs) : undefined;
    if (!word) return { active: false, mouth: 0 };
    const age = (time - word.startMs) / 1000, remaining = (word.endMs - time) / 1000;
    const envelope = Math.min(1, age / .035, remaining / .045);
    return { active: true, mouth: envelope * (.6 + .4 * Math.sin(age * 19) ** 2) };
  }
}

export function createMicrophone() {
  const root = new Group(); root.name = 'vocal-microphone';
  const metal = new MeshStandardMaterial({ color: '#343847', metalness: .8, roughness: .3 });
  const grille = new MeshStandardMaterial({ color: '#bfc9d5', metalness: .75, roughness: .65, wireframe: true });
  const base = new Mesh(new CylinderGeometry(.32, .36, .07, 32), metal); base.position.set(0, .035, .95);
  const pole = new Mesh(new CylinderGeometry(.025, .025, 1.85, 16), metal); pole.position.set(0, .96, .95);
  const handle = new Mesh(new CylinderGeometry(.065, .045, .28, 20), metal); handle.rotation.x = Math.PI / 2; handle.position.set(0, 1.98, .84);
  const capsule = new Mesh(new SphereGeometry(.09, 24, 16), grille); capsule.position.set(0, 1.98, .67);
  root.add(base, pole, handle, capsule);
  root.traverse(node => { if (node instanceof Mesh) node.castShadow = true; });
  return root;
}

export class SingerAnimator {
  private readonly score = new VocalScore();
  private readonly smoother: PoseSmoother;
  constructor(private readonly rig: CharacterRig) {
    this.smoother = new PoseSmoother([rig.body, rig.head, rig.leftArm, rig.rightArm, rig.leftLeg, rig.rightLeg]);
  }
  update(vocals: VocalPerformance | undefined, tempo: number, still = false, delta?: number) {
    const motion = this.score.sample(still ? undefined : vocals);
    this.rig.resetPose();
    if (motion.active) {
      const beat = (vocals!.positionMs / 1000) * tempo / 60, sway = Math.sin(beat * Math.PI);
      this.rig.body.position.x += sway * .055;
      this.rig.body.position.y += Math.abs(Math.sin(beat * Math.PI)) * .035;
      this.rig.body.rotation.z = sway * .035;
      this.rig.head.rotation.z = -sway * .045;
      this.rig.leftArm.rotation.z = -.28 - .13 * Math.sin(beat * Math.PI / 2);
      this.rig.rightArm.rotation.x = -.5;
      this.rig.rightArm.rotation.z = .18;
      this.rig.leftLeg.rotation.x = sway * .07;
      this.rig.rightLeg.rotation.x = -sway * .07;
    }
    this.smoother.update(still ? undefined : delta);
    // Mouth stops immediately at a word boundary, pause or seek, independent of pose damping.
    this.rig.setMouth(motion.mouth);
    return motion;
  }
}
