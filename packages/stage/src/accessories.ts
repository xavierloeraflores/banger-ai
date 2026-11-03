import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute, Group, Mesh,
  MeshStandardMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
  type ColorRepresentation,
} from 'three';
import type { CharacterRig } from './character.js';

export interface AccessorySelection {
  hat: 'none' | 'beanie' | 'cap' | 'bucket';
  neck: 'none' | 'chain' | 'tie';
  backpack: boolean;
  boots: boolean;
  color: string;
}
export interface CharacterAccessories {
  readonly selection: Readonly<AccessorySelection>;
  dispose(): void;
}
const colors = ['#b86848', '#527880', '#77598e', '#4c637e', '#977048', '#566f54'];

/** Outfits are chosen once when a performer loads, never during animation. */
export function createAccessories(rig: CharacterRig, options: { random?: () => number } = {}): CharacterAccessories {
  const random = options.random ?? Math.random;
  const pick = <T,>(values: readonly T[]): T => values[Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)))]!;
  const selection: AccessorySelection = {
    hat: pick(['none', 'beanie', 'cap', 'bucket'] as const),
    neck: pick(['none', 'chain', 'tie'] as const),
    backpack: random() < .35,
    boots: random() < .65,
    color: pick(colors),
  };
  // Every performer gets an outfit, including when all optional draws are empty.
  if (selection.hat === 'none' && selection.neck === 'none' && !selection.backpack && !selection.boots) selection.hat = 'beanie';
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
  const cord = (parent: Group, points: number[][], radius: number, surface: MeshStandardMaterial) => {
    const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x!, y!, z!)));
    return mesh(parent, new TubeGeometry(curve, 28, radius, 6, false), surface);
  };

  if (selection.hat !== 'none') {
    const hat = group(selection.hat, rig.sockets.head);
    // The crown socket is at the top of the hood. The lower rim hugs its slope.
    hat.position.y = -.12;
    if (selection.hat === 'beanie') {
      oval(hat, [.48, .27, .38], cloth, 0, .08);
      const cuff = mesh(hat, new TorusGeometry(.39, .075, 10, 40), cloth, 0, -.045);
      cuff.rotation.x = Math.PI / 2; cuff.scale.set(1.16, .92, 1);
      oval(hat, [.115, .115, .115], trim, 0, .34);
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI / 6;
        cord(hat, [[Math.cos(angle) * .435, -.02, Math.sin(angle) * .345], [Math.cos(angle) * .40, .17, Math.sin(angle) * .31], [Math.cos(angle) * .16, .32, Math.sin(angle) * .13]], .008, trim);
      }
    } else if (selection.hat === 'cap') {
      oval(hat, [.49, .23, .38], cloth, 0, .045);
      oval(hat, [.43, .035, .28], cloth, 0, -.08, .35);
      oval(hat, [.07, .07, .015], trim, 0, .07, .375);
      oval(hat, [.045, .025, .045], trim, 0, .28);
      hat.rotation.z = -.12;
    } else {
      const crown = mesh(hat, new CylinderGeometry(.32, .47, .30, 32), cloth, 0, .06);
      crown.scale.z = .81;
      const brim = mesh(hat, new CylinderGeometry(.48, .60, .085, 40), cloth, 0, -.13);
      brim.scale.z = .82;
      const band = mesh(hat, new CylinderGeometry(.454, .478, .06, 32), trim, 0, -.055);
      band.scale.z = .815;
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
    } else {
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
    oval(boot, [.29, .22, .35], cloth, 0, -.34, .045);
    oval(boot, [.295, .055, .355], dark, 0, -.515, .05);
    const cuff = mesh(boot, new TorusGeometry(.245, .04, 8, 28), trim, 0, -.19);
    cuff.rotation.x = Math.PI / 2; cuff.scale.y = 1.18;
    for (const y of [-.27, -.34]) cord(boot, [[-.085, y, .345], [0, y - .01, .39], [.085, y, .345]], .012, trim);
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
