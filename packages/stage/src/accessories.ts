import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute, Group, Mesh,
  LatheGeometry, MeshStandardMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
  type ColorRepresentation,
} from 'three';
import type { CharacterRig } from './character.js';

export interface AccessorySelection {
  hat: 'none' | 'beanie' | 'cap' | 'bucket';
  neck: 'none' | 'chain' | 'tie' | 'scarf';
  top: 'none' | 'jacket' | 'vest' | 'tshirt';
  watch: boolean;
  headphones: boolean;
  backpack: boolean;
  boots: boolean;
  color: string;
}
export interface CharacterAccessories {
  readonly selection: Readonly<AccessorySelection>;
  dispose(): void;
}
const colors = ['#b86848', '#527880', '#77598e', '#4c637e', '#977048', '#54606f'];

/** Outfits are chosen once when a performer loads, never during animation. */
export function createAccessories(rig: CharacterRig, options: { random?: () => number; selection?: Partial<AccessorySelection> } = {}): CharacterAccessories {
  const random = options.random ?? Math.random;
  const pick = <T,>(values: readonly T[]): T => values[Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)))]!;
  const selection: AccessorySelection = {
    hat: pick(['none', 'beanie', 'cap', 'bucket'] as const),
    neck: pick(['none', 'chain', 'tie', 'scarf'] as const),
    backpack: random() < .35,
    boots: random() < .65,
    color: pick(colors),
    top: pick(['jacket', 'vest', 'tshirt'] as const),
    watch: random() < .35,
    headphones: random() < .25,
    ...options.selection,
  };
  // Bags keep their exposed straps; headphones need the hood clear of hats.
  if (selection.backpack) selection.top = 'none';
  if (selection.headphones) selection.hat = 'none';
  // Every performer gets an outfit, including when all optional draws are empty.
  if (selection.hat === 'none' && selection.neck === 'none' && !selection.backpack && !selection.boots && selection.top === 'none' && !selection.watch && !selection.headphones) selection.hat = 'beanie';
  const geometries = new Set<BufferGeometry>(), materials = new Set<MeshStandardMaterial>(), groups: Group[] = [];
  const material = (color: ColorRepresentation, metalness = 0) => {
    const result = new MeshStandardMaterial({ color, roughness: metalness ? .28 : .86, metalness });
    materials.add(result); return result;
  };
  const cloth = material(selection.color), trim = material('#d9c9ac'), dark = material('#302f38'), gold = material('#d8ad60', .8);
  const group = (name: string, parent: Group) => {
    const result = new Group(); result.name = `accessory-${name}`; parent.add(result); groups.push(result); return result;
  };
  const mesh = (parent: Group, geometry: BufferGeometry, surface: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
    geometries.add(geometry);
    const result = new Mesh(geometry, surface); result.position.set(x, y, z);
    result.castShadow = true; result.receiveShadow = true; parent.add(result); return result;
  };
  const oval = (parent: Group, scale: [number, number, number], surface: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
    const result = mesh(parent, new SphereGeometry(1, 24, 16), surface, x, y, z); result.scale.set(...scale); return result;
  };
  const crown = (parent: Group, scale: [number, number, number]) => {
    // An open hemisphere seats around the hood instead of burying an oval in it.
    const result = mesh(parent, new SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
    result.scale.set(...scale); return result;
  };
  const shoeVolume = (parent: Group, scale: [number, number, number], surface: MeshStandardMaterial, y: number, roundness: number) => {
    // Match the plush foot's broad, rounded corners rather than an ellipsoid.
    const geometry = new SphereGeometry(1, 40, 28), positions = geometry.getAttribute('position');
    const round = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), roundness);
    for (let index = 0; index < positions.count; index++) {
      positions.setXYZ(index, round(positions.getX(index)) * scale[0], round(positions.getY(index)) * scale[1], round(positions.getZ(index)) * scale[2]);
    }
    geometry.computeVertexNormals();
    return mesh(parent, geometry, surface, 0, y, .055);
  };
  const cord = (parent: Group, points: number[][], radius: number, surface: MeshStandardMaterial) => {
    const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x!, y!, z!)));
    return mesh(parent, new TubeGeometry(curve, 28, radius, 6, false), surface);
  };

  if (selection.hat !== 'none') {
    const hat = group(selection.hat, rig.sockets.head);
    // Seat the opening above the face, wide enough for the hood and its fleece.
    hat.position.y = -.10;
    if (selection.hat === 'beanie') {
      crown(hat, [.59, .36, .44]);
      const cuff = mesh(hat, new TorusGeometry(.545, .055, 12, 48), cloth, 0, .015);
      cuff.rotation.x = Math.PI / 2; cuff.scale.y = .745;
      oval(hat, [.115, .115, .115], trim, 0, .43);
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI / 6;
        const points = Array.from({ length: 13 }, (_, step) => {
          const latitude = step / 12 * Math.PI / 2;
          return [Math.cos(angle) * .598 * Math.cos(latitude), .366 * Math.sin(latitude), Math.sin(angle) * .448 * Math.cos(latitude)];
        });
        cord(hat, points, .008, trim);
      }
    } else if (selection.hat === 'cap') {
      crown(hat, [.59, .33, .44]);
      oval(hat, [.52, .035, .32], cloth, 0, .005, .40);
      oval(hat, [.07, .07, .018], trim, 0, .12, .415);
      oval(hat, [.045, .025, .045], trim, 0, .34);
      hat.rotation.z = -.08;
    } else {
      const top = mesh(hat, new CylinderGeometry(.40, .57, .32, 40), cloth, 0, .16);
      top.scale.z = .76;
      const brim = mesh(hat, new CylinderGeometry(.59, .70, .085, 48), cloth, 0, .005);
      brim.scale.z = .76;
      const band = mesh(hat, new CylinderGeometry(.545, .577, .06, 40), trim, 0, .04);
      band.scale.z = .765;
    }
  }

  if (selection.neck !== 'none') {
    const neck = group(selection.neck, rig.body);
    if (selection.neck === 'chain') {
      // Separate alternating links make the chain readable at stage distance.
      for (let index = 0; index < 19; index++) {
        const t = index / 18, x = (t - .5) * 1.02;
        const link = mesh(neck, new TorusGeometry(.045, .012, 6, 10), gold, x, 1.18 - .22 * Math.sin(t * Math.PI), .39 + .18 * Math.sin(t * Math.PI));
        link.rotation.z = -.6 * Math.cos(t * Math.PI);
        link.rotation.y = index % 2 ? .8 : -.18;
      }
      const pendant = mesh(neck, new TorusGeometry(.075, .024, 8, 16), gold, 0, .83, .58);
      pendant.rotation.z = Math.PI / 4;
    } else if (selection.neck === 'tie') {
      cord(neck, [[-.47, 1.20, .36], [-.28, 1.12, .50], [0, 1.08, .55], [.28, 1.12, .50], [.47, 1.20, .36]], .028, cloth);
      const knot = mesh(neck, new BoxGeometry(.13, .12, .055), cloth, 0, 1.06, .59); knot.rotation.z = Math.PI / 4;
      const tie = new BufferGeometry();
      // A padded diamond silhouette with a short narrow neck, clear of the hands.
      const points = [-.045,.98,.59, .045,.98,.59, .105,.67,.59, 0,.57,.59, -.105,.67,.59];
      tie.setAttribute('position', new Float32BufferAttribute(points, 3));
      tie.setIndex([0, 1, 2, 0, 2, 4, 4, 2, 3]); tie.computeVertexNormals();
      const tieMaterial = material(selection.color); tieMaterial.side = 2;
      mesh(neck, tie, tieMaterial);
      mesh(neck, new BoxGeometry(.135, .025, .025), gold, 0, .78, .605);
    } else {
      const scarfCloth = material('#c98d88');
      for (const [y, radius] of [[1.12, .72], [1.025, .735]]) {
        const wrap = mesh(neck, new TorusGeometry(radius!, .075, 10, 48), scarfCloth, 0, y);
        wrap.rotation.x = Math.PI / 2; wrap.scale.y = .76;
      }
      for (const [x, y, length] of [[.30, .72, .30], [.46, .65, .32]]) {
        const tail = new SphereGeometry(1, 20, 14);
        const vertices = tail.getAttribute('position');
        const rounded = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), .35);
        for (let i = 0; i < vertices.count; i++) vertices.setXYZ(i, rounded(vertices.getX(i)) * .09, rounded(vertices.getY(i)) * length!, rounded(vertices.getZ(i)) * .04);
        tail.computeVertexNormals();
        mesh(neck, tail, scarfCloth, x, y, .65);
        for (let strand = 0; strand < 5; strand++) {
          cord(neck, [[x! - .07 + strand * .035, y! - length! + .02, .65], [x! - .07 + strand * .035, y! - length! - .065, .65]], .009, scarfCloth);
        }
      }
    }
  }

  if (selection.top !== 'none') {
    const top = group(selection.top, rig.body);
    const jacket = selection.top === 'jacket';
    const vest = selection.top === 'vest';
    const fabric = material(selection.color);
    fabric.side = 2;
    if (jacket) fabric.roughness = .35;
    // Follow the pear-shaped torso, outside the fleece. The open vest leaves
    // a strip of plush visible down the front, like the reference waistcoat.
    const profile = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32, y = .10 + t * 1.02;
      const radius = .72 + .075 * Math.sin(t * Math.PI) - .006 * t;
      const quilting = jacket ? .018 * Math.pow(Math.sin(t * Math.PI * 5), 2) : 0;
      return new Vector2(radius + quilting, y);
    });
    const shell = new LatheGeometry(profile, 56, vest ? .23 : 0, Math.PI * 2 - (vest ? .46 : 0));
    shell.scale(1, 1, .75);
    mesh(top, shell, fabric).name = 'garment-torso';
    for (const y of [.11, 1.11]) {
      const points = Array.from({ length: 49 }, (_, i) => {
        const angle = (vest ? .23 : 0) + i / 48 * (Math.PI * 2 - (vest ? .46 : 0));
        return [Math.sin(angle) * .72, y, Math.cos(angle) * .72 * .75];
      });
      cord(top, points, .027, fabric);
    }
    if (jacket || vest) {
      for (const side of vest ? [-1, 1] : [0]) {
        cord(top, profile.map(point => [side * Math.sin(.23) * point.x, point.y, point.x * .75 * (vest ? Math.cos(.23) : 1) + .012]), .018, trim);
      }
      for (const side of [-1, 1]) {
        const pocket = oval(top, [.14, .13, .035], fabric, side * .42, .36, .515);
        pocket.rotation.y = side * .5;
        cord(top, [[side * .30, .47, .56], [side * .42, .48, .555], [side * .52, .47, .49]], .014, trim);
      }
      if (jacket) {
        for (let row = 1; row < 5; row++) {
          const t = row / 5, radius = .72 + .075 * Math.sin(t * Math.PI) - .006 * t;
          const seam = mesh(top, new TorusGeometry(radius + .002, .008, 6, 48), dark, 0, .10 + t * 1.02);
          seam.rotation.x = Math.PI / 2; seam.scale.y = .75;
        }
        mesh(top, new BoxGeometry(.045, .075, .035), gold, 0, .94, .585);
      }
    }
    if (!vest) for (const [arm, side, name] of [[rig.leftArm, -1, 'left'], [rig.rightArm, 1, 'right']] as const) {
      // Use the same shoulder pivot, offset and tilt as the plush arm. Clothing
      // follows every arm pose without frame-by-frame copying or a second rig.
      const sleeve = group(`${name}-sleeve`, arm);
      sleeve.position.set(side * .16, -.37, .015); sleeve.rotation.z = side * .26;
      const end = jacket ? 2.30 : 1.48;
      const geometry = new SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, end);
      const vertices = geometry.getAttribute('position');
      const soften = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), .85);
      for (let i = 0; i < vertices.count; i++) {
        const y = vertices.getY(i);
        vertices.setXYZ(i, soften(vertices.getX(i)) * .255 * (1 + .08 * y), soften(y) * .53, soften(vertices.getZ(i)) * .275);
      }
      geometry.computeVertexNormals();
      mesh(sleeve, geometry, fabric);
      const cuff = mesh(sleeve, new TorusGeometry(1, .07, 8, 40), fabric, 0, soften(Math.cos(end)) * .53);
      cuff.rotation.x = Math.PI / 2;
      cuff.scale.set(Math.pow(Math.sin(end), .85) * .255 * (1 + .08 * Math.cos(end)), Math.pow(Math.sin(end), .85) * .275, .25);
    }
  }

  if (selection.watch) {
    const watch = group('watch', rig.sockets.leftHand);
    watch.position.y = .015; watch.rotation.z = -.26;
    const strap = mesh(watch, new TorusGeometry(.135, .03, 8, 32), dark);
    strap.rotation.x = Math.PI / 2; strap.scale.y = 1.12;
    oval(watch, [.088, .105, .025], gold, 0, 0, .165);
    oval(watch, [.069, .084, .012], dark, 0, 0, .19);
    cord(watch, [[0, .055, .205], [0, 0, .21], [.04, -.02, .205]], .008, trim);
  }

  if (selection.headphones) {
    const headphones = group('headphones', rig.head);
    const points = Array.from({ length: 25 }, (_, i) => {
      const angle = i / 24 * Math.PI;
      return [Math.cos(angle) * .765, .33 + Math.sin(angle) * .60, 0];
    });
    cord(headphones, points, .065, dark);
    for (const side of [-1, 1]) {
      oval(headphones, [.10, .205, .24], dark, side * .71, .30);
      oval(headphones, [.08, .17, .20], cloth, side * .79, .30);
      oval(headphones, [.016, .065, .08], gold, side * .868, .30);
    }
  }

  if (selection.backpack) {
    const backpack = group('backpack', rig.sockets.back);
    oval(backpack, [.42, .45, .20], cloth, 0, -.02, -.15);
    oval(backpack, [.31, .21, .09], cloth, 0, -.19, -.315);
    cord(backpack, [[-.24, -.08, -.385], [0, -.06, -.42], [.24, -.08, -.385]], .012, trim);
    cord(backpack, [[-.12, .33, -.13], [-.12, .48, -.13], [.12, .48, -.13], [.12, .33, -.13]], .035, cloth);
    for (const side of [-1, 1]) {
      cord(backpack, [[side * .28, .33, -.08], [side * .48, .35, .13], [side * .60, .18, .25], [side * .60, -.15, .22], [side * .28, -.38, -.08]], .045, cloth);
    }
  }

  if (selection.boots) for (const [leg, side] of [[rig.leftLeg, 'left'], [rig.rightLeg, 'right']] as const) {
    const boot = group(`${side}-boot`, leg);
    shoeVolume(boot, [.315, .285, .395], cloth, -.275, .62);
    shoeVolume(boot, [.325, .045, .405], dark, -.525, .30);
    const cuff = mesh(boot, new TorusGeometry(.29, .028, 10, 40), trim, 0, -.10, .055);
    cuff.rotation.x = Math.PI / 2; cuff.scale.y = 1.25;
    for (const y of [-.21, -.29]) cord(boot, [[-.10, y, .435], [0, y - .01, .455], [.10, y, .435]], .014, trim);
  }

  let disposed = false;
  return {
    selection: Object.freeze(selection),
    dispose() {
      if (disposed) return; disposed = true;
      groups.forEach(item => item.removeFromParent());
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
    },
  };
}
