import * as THREE from 'three';

type Shot = 'wide' | 'close' | 'overhead' | 'orbit';
const shots: Shot[] = ['wide', 'close', 'overhead', 'orbit'];

/** Timed concert shots, independent of playback, with a separate manual-input camera. */
export class StageCamera {
  readonly input: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private distance = 10;
  private elevation = .19;
  private elapsed = 0;
  private duration = 6;
  private shot: Shot = 'wide';
  private remainingShots: Shot[] = [];
  private subjects: THREE.Vector3[] = [];
  private subject = 0;
  private side = 1;
  private variation = .5;
  private initialized = false;
  manual = false;

  constructor(readonly camera: THREE.PerspectiveCamera, readonly reducedMotion = false, private readonly random = Math.random) {
    this.input = camera.clone();
    this.duration = 2 + this.random() * 8;
  }

  get shotName() { return this.shot; }

  frame(center: THREE.Vector3, distance: number, elevation: number, subjects: THREE.Vector3[] = []) {
    this.center.copy(center);
    this.distance = distance;
    this.elevation = elevation;
    this.subjects = subjects.map(subject => subject.clone());
    this.subject %= Math.max(1, this.subjects.length);
    if (!this.initialized) {
      this.tour();
      this.camera.position.copy(this.input.position);
      this.focus.copy(this.target);
      this.camera.lookAt(this.focus);
      this.initialized = true;
    }
  }

  setManual(manual: boolean) {
    this.manual = manual;
    // Start manual input exactly where the visible camera is, even mid-transition.
    this.input.position.copy(this.camera.position);
    this.target.copy(this.focus);
    this.input.lookAt(this.target);
  }

  reset() {
    this.elapsed = 0;
    this.shot = 'wide';
    this.remainingShots = [];
    this.side = 1;
    this.duration = 2 + this.random() * 8;
    this.tour();
  }

  zoom(factor: number, minDistance: number, maxDistance: number) {
    if (!this.manual) return;
    this.offset.subVectors(this.input.position, this.target);
    this.offset.setLength(THREE.MathUtils.clamp(this.offset.length() * factor, minDistance, maxDistance));
    this.input.position.copy(this.target).add(this.offset);
  }

  private nextShot() {
    // A shuffled bag guarantees variety without repeating the last angle.
    if (!this.remainingShots.length) this.remainingShots = shots.filter(shot => shot !== this.shot);
    const index = Math.floor(this.random() * this.remainingShots.length);
    this.shot = this.remainingShots.splice(index, 1)[0]!;
    this.duration = 2 + this.random() * 8;
    this.subject = Math.floor(this.random() * Math.max(1, this.subjects.length));
    this.side = this.random() < .5 ? -1 : 1;
    this.variation = this.random();
  }

  private tour() {
    const progress = this.reducedMotion ? 0 : this.elapsed / this.duration;
    let azimuth = this.side * (.08 + progress * .14);
    let distance = this.distance * (1 + .04 * Math.sin(progress * Math.PI));
    let elevation = this.elevation;
    this.target.copy(this.center);
    const subject = this.subjects[this.subject];
    if (!this.reducedMotion && subject && (this.shot === 'close' || this.shot === 'orbit')) {
      this.target.copy(subject);
      // Keep the character framed on narrow screens too. Orbit along the front
      // of the riser so the camera never passes behind the stage backdrop.
      const portrait = 1 / Math.min(1, Math.max(.35, this.camera.aspect));
      distance = (this.shot === 'close' ? 5.6 + this.variation : 7.2) * portrait;
      elevation = this.shot === 'close' ? .12 : .34;
      azimuth = this.shot === 'close'
        ? this.side * (.35 + progress * .15)
        : this.side * (-.95 + progress * 1.9);
      if (this.shot === 'close') distance *= 1 - progress * .12;
    } else if (!this.reducedMotion && this.shot === 'overhead') {
      elevation = .95;
      distance = this.distance * .95;
      azimuth = this.side * (-.3 + progress * .6);
      this.target.x += this.side * (progress - .5) * this.distance * .16;
    }
    if (this.reducedMotion) azimuth = 0;
    this.input.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * Math.cos(elevation) * distance,
    ).add(this.target);
  }

  update(delta: number) {
    // A background tab or a stalled frame must not jump ahead in the tour.
    const seconds = THREE.MathUtils.clamp(delta, 0, .1);
    let cut = false;
    if (!this.manual) {
      if (!this.reducedMotion) this.elapsed += seconds;
      if (!this.reducedMotion && this.elapsed + 1e-9 >= this.duration) {
        this.elapsed = Math.max(0, this.elapsed - this.duration);
        this.nextShot();
        cut = true;
      }
      this.tour();
    }
    const blend = this.reducedMotion || cut ? 1 : -Math.expm1(-seconds * (this.manual ? 9 : 2));
    this.camera.position.lerp(this.input.position, blend);
    this.focus.lerp(this.target, blend);
    this.camera.lookAt(this.focus);
  }
}
