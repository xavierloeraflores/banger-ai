import * as THREE from 'three';

/** A wall-clock tour, independent of playback, with a separate smoothed render camera. */
export class StageCamera {
  readonly input: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private distance = 10;
  private elevation = .19;
  private elapsed = 0;
  private initialized = false;
  manual = false;

  constructor(readonly camera: THREE.PerspectiveCamera, readonly reducedMotion = false) {
    this.input = camera.clone();
  }

  frame(center: THREE.Vector3, distance: number, elevation: number) {
    this.center.copy(center);
    this.distance = distance;
    this.elevation = elevation;
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
    this.tour();
  }

  zoom(factor: number, minDistance: number, maxDistance: number) {
    if (!this.manual) return;
    this.offset.subVectors(this.input.position, this.target);
    this.offset.setLength(THREE.MathUtils.clamp(this.offset.length() * factor, minDistance, maxDistance));
    this.input.position.copy(this.target).add(this.offset);
  }

  private tour() {
    const time = this.reducedMotion ? 0 : this.elapsed;
    const azimuth = Math.sin(time * .12) * .16;
    const distance = this.distance * (1 + .06 * (1 - Math.cos(time * .16)));
    const elevation = this.elevation + Math.sin(time * .09) * .018;
    this.target.copy(this.center);
    this.target.x += Math.sin(time * .1) * this.distance * .012;
    this.input.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * Math.cos(elevation) * distance,
    ).add(this.target);
  }

  update(delta: number) {
    // A background tab or a stalled frame must not jump ahead in the tour.
    const seconds = THREE.MathUtils.clamp(delta, 0, .1);
    if (!this.manual) {
      if (!this.reducedMotion) this.elapsed += seconds;
      this.tour();
    }
    const blend = this.reducedMotion ? 1 : -Math.expm1(-seconds * (this.manual ? 9 : 2));
    this.camera.position.lerp(this.input.position, blend);
    this.focus.lerp(this.target, blend);
    this.camera.lookAt(this.focus);
  }
}
