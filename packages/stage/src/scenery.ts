import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { StagePosition } from './concert.js';

const cyan = '#53deff', violet = '#b264ff';
const luminous = (color: string) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3, roughness: .35 });

/** All geometry belongs to root and is disposed by the scene owner. */
export function createScenery() {
  const root = new THREE.Group(); root.name = 'concert-scenery';
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#151825', roughness: .28, metalness: .55 });
  const edgeMaterial = luminous(cyan);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .3, 96), deckMaterial);
  deck.position.y = -.18; deck.receiveShadow = true; root.add(deck);
  const reflection = new Reflector(new THREE.CircleGeometry(1, 96), {
    textureWidth: 512, textureHeight: 512, multisample: 0, clipBias: .003,
    shader: {
      name: 'SoftStageReflection',
      uniforms: { color: { value: new THREE.Color() }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() } },
      vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; void main(){vUv=textureMatrix*vec4(position,1.);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec4 vUv;
        void main(){vec2 uv=vUv.xy/vUv.w; vec3 reflected=vec3(0.);
          for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
            reflected+=texture2D(tDiffuse,uv+vec2(float(x)*.004,float(y)*.009)).rgb/9.;
          }
          gl_FragColor=vec4(vec3(.009,.012,.021)+reflected*.085,1.);
        }`,
    },
  });
  reflection.rotation.x = -Math.PI / 2; reflection.position.y = -.025; root.add(reflection);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(1, .009, 8, 128), edgeMaterial);
  edge.rotation.x = Math.PI / 2; edge.position.y = -.07; root.add(edge);
  const backdropMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, chord: { value: 0 }, accent: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float chord; uniform float accent;
      void main(){
        vec2 p=(vUv-.5)*vec2(2.2,1.); float r=length(p);
        float waves=.5+.5*sin(r*(27.-chord*7.)-time*.7);
        float rings=pow(waves,22.); float dots=.88+.12*sin(vUv.x*900.)*sin(vUv.y*400.);
        vec3 tint=mix(vec3(.10,.025,.34),vec3(.03,.65,.85),.5+.5*sin(r*5.-time*.12));
        vec3 color=vec3(.008,.01,.025)+tint*rings*dots*(1.6+chord*2.4+accent*.3);
        gl_FragColor=vec4(color,1.);
      }`,
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMaterial); root.add(backdrop);
  const floorMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { kick: { value: 0 }, chord: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv;uniform float kick;uniform float chord;
      void main(){vec2 p=(vUv-.5)*2.;float r=length(p);
        float ring=exp(-pow((r-(1.-kick*.7))*24.,2.))*kick;
        float reflection=exp(-p.x*p.x*7.)*(.5+.5*cos(p.y*32.))*pow(max(0.,1.-abs(p.y)),3.);
        gl_FragColor=vec4(mix(vec3(.18,.06,.5),vec3(.06,.55,.7),vUv.x),ring*.4+reflection*(.035+chord*.035));}`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.018; root.add(floor);
  const lights = Array.from({ length: 4 }, (_, i) => {
    const color = i % 2 ? violet : cyan;
    const light = new THREE.SpotLight(color, 70, 35, .38, .85, 2); root.add(light, light.target);
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, strength: { value: .12 }, time: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; void main(){vUv=uv;vNormal=normalMatrix*normal;vec4 view=modelViewMatrix*vec4(position,1.);vView=-view.xyz;gl_Position=projectionMatrix*view;}',
      fragmentShader: `varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;uniform vec3 color;uniform float strength;uniform float time;
        void main(){float edge=pow(abs(dot(normalize(vNormal),normalize(vView))),2.);float fade=smoothstep(0.,.3,vUv.y)*(1.-smoothstep(.8,1.,vUv.y));
          float haze=.85+.15*sin(vUv.y*32.+sin(vUv.x*19.)+time*.3);
          gl_FragColor=vec4(color,edge*fade*haze*strength);}`,
    });
    // Tip at local origin, beam extends down -Y toward the spotlight target.
    const geometry = new THREE.ConeGeometry(1, 1, 32, 1, true); geometry.translate(0, -.5, 0);
    const beam = new THREE.Mesh(geometry, material); root.add(beam);
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(.17, .24, .4, 16), deckMaterial); root.add(fixture);
    return { light, beam, fixture, material };
  });
  const down = new THREE.Vector3(0, -1, 0), direction = new THREE.Vector3();
  let width = 10, back = -6, front = 5;
  return {
    root,
    dispose() { reflection.getRenderTarget().dispose(); },
    layout(positions: StagePosition[]) {
      width = Math.max(5, ...positions.map(p => Math.abs(p.x) + 1.8));
      back = Math.min(-5, ...positions.map(p => p.z - 2)); front = Math.max(4, ...positions.map(p => p.z + 2));
      const center = (back + front) / 2, depth = (front - back) / 2;
      reflection.scale.set(width, depth, 1); reflection.position.z = center;
      deck.scale.set(width, 1, depth); deck.position.z = center;
      edge.scale.set(width, depth, 1); edge.position.z = center;
      floor.scale.set(width * 2, depth * 2, 1); floor.position.z = center;
      backdrop.position.set(0, 3.6, back - .5); backdrop.scale.set(width * 2, 8, 1);
      lights.forEach(({ light, fixture }, i) => { light.position.set((i / 3 - .5) * width * 1.8, 7.5, back + .8); fixture.position.copy(light.position); });
    },
    update(time: number, signals: { kick: number; snare: number; chord: number; chorus: boolean }, targets: THREE.Vector3[]) {
      backdropMaterial.uniforms.time!.value = time;
      backdropMaterial.uniforms.chord!.value = signals.chord;
      backdropMaterial.uniforms.accent!.value = signals.snare;
      floorMaterial.uniforms.kick!.value = signals.kick; floorMaterial.uniforms.chord!.value = signals.chord;
      edgeMaterial.emissiveIntensity = 2.3 + signals.kick * 1.5;
      lights.forEach(({ light, beam, fixture, material }, i) => {
        const target = targets[i % Math.max(1, targets.length)];
        light.target.position.copy(target ?? new THREE.Vector3(0, 0, 0));
        light.target.position.x += Math.sin(time * .24 + i * 2) * (signals.chorus ? 3.2 : .35);
        light.intensity = 65 + signals.snare * 35;
        light.angle = signals.chorus ? .52 : .34;
        direction.subVectors(light.target.position, light.position);
        const length = direction.length();
        beam.position.copy(light.position); beam.quaternion.setFromUnitVectors(down, direction.normalize());
        beam.scale.set(length * Math.tan(light.angle), length, length * Math.tan(light.angle));
        fixture.quaternion.copy(beam.quaternion);
        material.uniforms.time!.value = time; material.uniforms.strength!.value = .055 + signals.snare * .025;
      });
    },
  };
}
