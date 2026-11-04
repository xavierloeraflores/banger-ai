import {
  Bone, BufferGeometry, CatmullRomCurve3, Color, Curve, DataTexture, Float32BufferAttribute, Group,
  InstancedMesh, LinearFilter, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, RepeatWrapping,
  LatheGeometry, RGBAFormat, Skeleton, SkinnedMesh, SphereGeometry, SRGBColorSpace, TubeGeometry, Uint16BufferAttribute, Vector2, Vector3,
  type ColorRepresentation,
} from 'three';

export interface CharacterRig {
  root: Group;
  /** Hips pivot. The head and arms follow this pivot. */
  body: Group;
  head: Group;
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  sockets: { leftHand: Group; rightHand: Group; head: Group; back: Group };
  setMouth(open: number): void;
  resetPose(): void;
  setColor(color: ColorRepresentation): void;
  dispose(): void;
}

function randomGenerator(seed: number) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
}

/** Rounded rectangle-like volumes, without a hard edge around the face. */
function plushVolume(x: number, y: number, z: number, roundness = 1, pear = 0): BufferGeometry {
  const geometry = new SphereGeometry(1, 40, 28);
  const positions = geometry.getAttribute('position');
  const soften = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), roundness);
  for (let i = 0; i < positions.count; i++) {
    const py = positions.getY(i);
    const width = 1 - pear * py;
    positions.setXYZ(i, soften(positions.getX(i)) * x * width, soften(py) * y, soften(positions.getZ(i)) * z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** One continuous hood/body profile; the head blend has no visible collar seam. */
const hoodProfile = new CatmullRomCurve3([
    new Vector3(0, -.16, 0), new Vector3(.43, -.09, 0), new Vector3(.67, .10, 0),
    new Vector3(.76, .43, 0), new Vector3(.75, .77, 0), new Vector3(.69, 1.08, 0),
    new Vector3(.69, 1.38, 0), new Vector3(.68, 1.68, 0), new Vector3(.56, 1.95, 0),
    new Vector3(.32, 2.12, 0), new Vector3(0, 2.175, 0),
]);

function bodyGeometry(): BufferGeometry {
  const points = hoodProfile.getPoints(64).map(point => new Vector2(Math.max(0, point.x), point.y));
  const geometry = new LatheGeometry(points, 56);
  geometry.scale(1, 1, .72);
  return geometry;
}

/** The face follows the hood curvature, so its sides stay tucked into the plush. */
function faceGeometry(): BufferGeometry {
  const geometry = plushVolume(.525, .395, 1, .68);
  const positions = geometry.getAttribute('position');
  const profile = hoodProfile.getPoints(256);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), dome = positions.getZ(i);
    const height = y + 1.6;
    const next = profile.findIndex(point => point.y >= height);
    const upper = profile[Math.max(1, next)]!, lower = profile[Math.max(0, next - 1)]!;
    const t = (height - lower.y) / (upper.y - lower.y);
    const radius = lower.x + (upper.x - lower.x) * t;
    const hoodDepth = .72 * Math.sqrt(Math.max(0, radius * radius - x * x));
    // The back half is buried; the front has a softly padded center and a flush edge.
    positions.setZ(i, hoodDepth - .47 + .008 + dome * (dome > 0 ? .055 : .06));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addSkinWeights(geometry: BufferGeometry): void {
  const positions = geometry.getAttribute('position'), indices: number[] = [], weights: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const blend = Math.max(0, Math.min(1, (positions.getY(i) - 1.02) / .42));
    const smooth = blend * blend * (3 - 2 * blend);
    indices.push(0, 1, 0, 0); weights.push(1 - smooth, smooth, 0, 0);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
}

function fleeceTexture(): DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4), random = randomGenerator(719);
  for (let i = 0; i < size * size; i++) {
    const grain = Math.round(195 + random() * 60);
    pixels.set([grain, grain, grain, 255], i * 4);
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter; texture.minFilter = LinearFilter;
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; texture.repeat.set(4, 4);
  texture.needsUpdate = true;
  return texture;
}

/** Short, individually lit fibers follow each deformable part's surface. */
function addFleece(mesh: Mesh, count: number, material: MeshStandardMaterial, seed: number, geometries: Set<BufferGeometry>, length = .026) {
  const blade = new BufferGeometry();
  blade.setAttribute('position', new Float32BufferAttribute([
    -.0018, 0, 0, .0018, 0, 0, .004, length, .002,
    0, 0, -.0018, 0, 0, .0018, .004, length, .002,
  ], 3));
  blade.computeVertexNormals();
  geometries.add(blade);
  const fleece = new InstancedMesh(blade, material, count);
  fleece.name = 'plush-fibers';
  const geometry = mesh.geometry, positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), indices = geometry.index!;
  const triangleCount = indices.count / 3, cumulative = new Float32Array(triangleCount);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
  let total = 0;
  for (let i = 0; i < triangleCount; i++) {
    a.fromBufferAttribute(positions, indices.getX(i * 3));
    b.fromBufferAttribute(positions, indices.getX(i * 3 + 1));
    c.fromBufferAttribute(positions, indices.getX(i * 3 + 2));
    total += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    cumulative[i] = total;
  }
  const random = randomGenerator(seed), matrix = new Matrix4(), point = new Vector3(), normal = new Vector3(), up = new Vector3(0, 1, 0), rotation = new Quaternion(), scale = new Vector3();
  const skinnedPositions: number[] = [];
  const vertex = new Vector3();
  for (let i = 0; i < count; i++) {
    const target = random() * total;
    let low = 0, high = triangleCount - 1;
    while (low < high) { const mid = (low + high) >>> 1; if (cumulative[mid]! < target) low = mid + 1; else high = mid; }
    const ia = indices.getX(low * 3), ib = indices.getX(low * 3 + 1), ic = indices.getX(low * 3 + 2);
    const u = Math.sqrt(random()), v = random(), wa = 1 - u, wb = u * (1 - v), wc = u * v;
    point.set(0, 0, 0).addScaledVector(a.fromBufferAttribute(positions, ia), wa).addScaledVector(b.fromBufferAttribute(positions, ib), wb).addScaledVector(c.fromBufferAttribute(positions, ic), wc);
    normal.set(0, 0, 0).addScaledVector(a.fromBufferAttribute(normals, ia), wa).addScaledVector(b.fromBufferAttribute(normals, ib), wb).addScaledVector(c.fromBufferAttribute(normals, ic), wc).normalize();
    rotation.setFromUnitVectors(up, normal);
    scale.setScalar(.65 + random() * .75);
    matrix.compose(point, rotation, scale);
    if (mesh instanceof SkinnedMesh) {
      const vertices = blade.getAttribute('position');
      for (let j = 0; j < vertices.count; j++) { vertex.fromBufferAttribute(vertices, j).applyMatrix4(matrix); skinnedPositions.push(vertex.x, vertex.y, vertex.z); }
    }
    fleece.setMatrixAt(i, matrix);
    fleece.setColorAt(i, new Color().setScalar(.82 + random() * .18));
  }
  fleece.instanceMatrix.needsUpdate = true;
  if (mesh instanceof SkinnedMesh) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(skinnedPositions, 3));
    geometry.computeVertexNormals(); addSkinWeights(geometry); geometries.add(geometry);
    const strands = new SkinnedMesh(geometry, material); strands.name = 'plush-fibers';
    mesh.add(strands); strands.bind(mesh.skeleton, mesh.bindMatrix); fleece.dispose();
  } else mesh.add(fleece);
}

class SmileCurve extends Curve<Vector3> {
  constructor() { super(); }
  getPoint(t: number, target = new Vector3()): Vector3 {
    const x = (t - .5) * .18;
    return target.set(x, -.105 + .036 * Math.pow(2 * t - 1, 2), .095 - .01 * Math.pow(2 * t - 1, 2));
  }
}

/** A reusable articulated plush. All geometry is local and requires no assets or DOM. */
export function createCharacter(options: { color?: ColorRepresentation } = {}): CharacterRig {
  const root = new Group(); root.name = 'banger-plush';
  const geometries = new Set<BufferGeometry>(), materials = new Set<MeshStandardMaterial>();
  const texture = fleeceTexture();
  const material = (color: ColorRepresentation, roughness = 1) => {
    const result = new MeshStandardMaterial({ color, roughness }); materials.add(result); return result;
  };
  const fur = material(options.color ?? '#eee3cf');
  fur.map = texture; fur.bumpMap = texture; fur.bumpScale = .007;
  const fibers = material(options.color ?? '#eee3cf');
  fibers.side = 2;
  const skin = material('#f0d9b7', .93), eyes = material('#090807', .1), smile = material('#241b15');
  const glint = material('#fff9e8', .15);
  const joint = (name: string, parent: Group, x: number, y: number, z = 0) => { const group = new Group(); group.name = name; group.position.set(x, y, z); parent.add(group); return group; };
  const volume = (parent: Group | Mesh, geometry: BufferGeometry, surface: MeshStandardMaterial, x = 0, y = 0, z = 0, fleece = 0, fiberLength = .026) => {
    geometries.add(geometry);
    const mesh = new Mesh(geometry, surface); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    if (fleece) addFleece(mesh, fleece, fibers, geometries.size * 197, geometries, fiberLength);
    return mesh;
  };
  const body = joint('body', root, 0, .52);
  const head = joint('head', body, 0, 1.31);
  const shellGeometry = bodyGeometry(); addSkinWeights(shellGeometry); geometries.add(shellGeometry);
  const shell = new SkinnedMesh(shellGeometry, fur); shell.name = 'hood-and-body';
  shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const baseBone = new Bone(), headBone = new Bone(); body.add(baseBone); head.add(headBone);
  const skeleton = new Skeleton([baseBone, headBone]);
  root.updateMatrixWorld(true); shell.bind(skeleton);
  addFleece(shell, 5200, fibers, 197, geometries);
  // Face is a soft rounded rectangular patch nested in the hood, like the reference.
  const face = volume(head, faceGeometry(), skin, 0, .29, .47);
  face.name = 'face';
  for (const side of [-1, 1]) {
    const eye = volume(face, plushVolume(.058, .065, .028), eyes, side * .255, .018, .035);
    eye.name = side < 0 ? 'left-eye' : 'right-eye';
    volume(eye, plushVolume(.012, .015, .006), glint, -.014, .023, .024);
    // Layered translucent blush keeps the edges soft without an image texture.
    for (let layer = 0; layer < 4; layer++) {
      const cheek = material('#ec8d7c'); cheek.transparent = true; cheek.opacity = .12;
      const blush = volume(face, plushVolume(.105 - layer * .014, .073 - layer * .009, .004), cheek, side * .31, -.09, .03 + layer * .001);
      blush.rotation.y = side * .42;
    }
  }
  const mouth = new TubeGeometry(new SmileCurve(), 18, .009, 7, false);
  const closedMouth = volume(face, mouth, smile); closedMouth.name = 'smile';
  const openMouth = volume(face, plushVolume(.085, .105, .016), smile, 0, -.105, .099);
  openMouth.name = 'singing-mouth'; openMouth.visible = false;
  const leftArm = joint('leftArm', body, -.64, .95), rightArm = joint('rightArm', body, .64, .95);
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    const sleeve = volume(arm, plushVolume(.215, .50, .235, .85, -.08), fur, side * .16, -.37, .015, 620);
    sleeve.rotation.z = side * .26;
  }
  const leftLeg = joint('leftLeg', root, -.34, .57), rightLeg = joint('rightLeg', root, .34, .57);
  for (const leg of [leftLeg, rightLeg]) volume(leg, plushVolume(.27, .285, .31, .62), fur, 0, -.285, .015, 480, .018);
  const sockets = {
    leftHand: joint('leftHandSocket', leftArm, -.27, -.79, .015),
    rightHand: joint('rightHandSocket', rightArm, .27, -.79, .015),
    head: joint('headSocket', head, 0, .865),
    back: joint('backSocket', body, 0, .8, -.49),
  };
  const joints = [body, head, leftArm, rightArm, leftLeg, rightLeg];
  const rest = joints.map(node => ({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  let disposed = false;
  return {
    root, body, head, leftArm, rightArm, leftLeg, rightLeg, sockets,
    setMouth(open) {
      const amount = Number.isFinite(open) ? Math.max(0, Math.min(1, open)) : 0;
      closedMouth.visible = amount <= .01; openMouth.visible = amount > .01;
      openMouth.scale.set(1 - amount * .18, Math.max(.05, amount), 1);
    },
    resetPose() { for (const pose of rest) { pose.node.position.copy(pose.position); pose.node.quaternion.copy(pose.quaternion); pose.node.scale.copy(pose.scale); } },
    setColor(color) { fur.color.set(color); fibers.color.set(color); },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.traverse((node: Object3D) => { if (node instanceof InstancedMesh) node.dispose(); });
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
      skeleton.dispose(); texture.dispose(); root.removeFromParent();
    },
  };
}
