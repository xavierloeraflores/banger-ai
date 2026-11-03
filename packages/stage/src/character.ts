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
function bodyGeometry(): BufferGeometry {
  const profile = new CatmullRomCurve3([
    new Vector3(0, -.16, 0), new Vector3(.43, -.09, 0), new Vector3(.67, .10, 0),
    new Vector3(.76, .43, 0), new Vector3(.75, .77, 0), new Vector3(.69, 1.08, 0),
    new Vector3(.64, 1.38, 0), new Vector3(.63, 1.68, 0), new Vector3(.54, 1.95, 0),
    new Vector3(.32, 2.12, 0), new Vector3(0, 2.175, 0),
  ]);
  const points = profile.getPoints(64).map(point => new Vector2(Math.max(0, point.x), point.y));
  const geometry = new LatheGeometry(points, 56);
  geometry.scale(1, 1, .72);
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
function addFleece(mesh: Mesh, count: number, material: MeshStandardMaterial, seed: number, geometries: Set<BufferGeometry>) {
  const blade = new BufferGeometry();
  blade.setAttribute('position', new Float32BufferAttribute([
    -.0025, 0, 0, .0025, 0, 0, .001, .018, .001,
    0, 0, -.0025, 0, 0, .0025, .001, .018, .001,
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
    const x = (t - .5) * .155;
    return target.set(x, -.078 + .032 * Math.pow(2 * t - 1, 2), .045);
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
  const fur = material(options.color ?? '#e9d9b8');
  fur.map = texture; fur.bumpMap = texture; fur.bumpScale = .007;
  const fibers = material(options.color ?? '#e9d9b8');
  fibers.side = 2;
  const skin = material('#efbc88', .93), eyes = material('#171512', .14), smile = material('#3e3325');
  const glint = material('#fff9e8', .15);
  const joint = (name: string, parent: Group, x: number, y: number, z = 0) => { const group = new Group(); group.name = name; group.position.set(x, y, z); parent.add(group); return group; };
  const volume = (parent: Group | Mesh, geometry: BufferGeometry, surface: MeshStandardMaterial, x = 0, y = 0, z = 0, fleece = 0) => {
    geometries.add(geometry);
    const mesh = new Mesh(geometry, surface); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    if (fleece) addFleece(mesh, fleece, fibers, geometries.size * 197, geometries);
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
  addFleece(shell, 3600, fibers, 197, geometries);
  // Face is a soft rounded rectangular patch nested in the hood, like the reference.
  const face = volume(head, plushVolume(.46, .33, .035, .78), skin, 0, .29, .47);
  face.name = 'face';
  for (const side of [-1, 1]) {
    volume(face, plushVolume(.055, .06, .036), eyes, side * .235, .035, .033);
    volume(face, plushVolume(.014, .015, .008), glint, side * .235 - .013, .055, .064);
    // Layered translucent blush keeps the edges soft without an image texture.
    for (let layer = 0; layer < 4; layer++) {
      const cheek = material('#ec8d7c'); cheek.transparent = true; cheek.opacity = .12;
      volume(face, plushVolume(.088 - layer * .012, .063 - layer * .008, .004), cheek, side * .28, -.075, .041 + layer * .001);
    }
  }
  const mouth = new TubeGeometry(new SmileCurve(), 18, .009, 7, false);
  volume(face, mouth, smile);
  const leftArm = joint('leftArm', body, -.64, .95), rightArm = joint('rightArm', body, .64, .95);
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    const sleeve = volume(arm, plushVolume(.192, .52, .215, .85), fur, side * .16, -.37, .015, 620);
    sleeve.rotation.z = side * .26;
  }
  const leftLeg = joint('leftLeg', root, -.34, .57), rightLeg = joint('rightLeg', root, .34, .57);
  for (const leg of [leftLeg, rightLeg]) volume(leg, plushVolume(.255, .285, .29, .57), fur, 0, -.285, .015, 480);
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
