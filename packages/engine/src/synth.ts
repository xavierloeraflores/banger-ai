import { INIT_SYNTH, type SynthConfig } from '@banger/compiler';
import type { MusicEvent } from './events.js';
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer[]>();
function noiseBuffer(context: BaseAudioContext, metal: boolean): AudioBuffer {
  let buffers = noiseCache.get(context); if (!buffers) { buffers = []; noiseCache.set(context,buffers); }
  const index = Number(metal); if (buffers[index]) return buffers[index];
  const buffer = context.createBuffer(1,context.sampleRate,context.sampleRate), data = buffer.getChannelData(0);
  let seed = 1234567;
  for (let i=0;i<data.length;i++) {
    seed = Math.imul(seed,1664525)+1013904223|0;
    data[i] = metal ? [1,1.342,1.231,1.653,1.952,2.152].reduce((sum,ratio)=>sum+Math.sign(Math.sin(i/context.sampleRate*420*ratio*Math.PI*2)),0)/6 : seed/2147483648;
  }
  buffers[index] = buffer; return buffer;
}
export function synthForEvent(event: MusicEvent): SynthConfig | null | undefined {
  const config = event.track.modular === null ? null : event.track.modular?.config ?? event.track.synth;
  return config ? {...config,...event.step.locks} : config;
}
export function synthRelease(event: MusicEvent): number { return synthForEvent(event)?.release ?? 0; }
/** Each note owns its modulation graph. At most four unison voices and two LFOs. */
export function scheduleSynth(context: BaseAudioContext, input: AudioNode, event: MusicEvent, config: SynthConfig, previousMidi?: number) {
  const nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = [];
  const own = <T extends AudioNode>(node:T):T => { nodes.push(node); return node; };
  const oscillator = (type: OscillatorType, frequency: number):OscillatorNode => { const node=own(context.createOscillator());node.type=type;node.frequency.value=frequency;sources.push(node);return node; };
  const gain = (value:number) => { const node=own(context.createGain());node.gain.value=value;return node; };
  const time=event.time, duration=Math.max(.005,event.duration*(event.sustained?1:.85)), off=time+duration, end=off+config.release;
  const midi=event.step.kind==='note'?event.step.midi:36, frequency=Math.min(context.sampleRate*.4,440*2**((midi-69)/12));
  const amp=gain(0), tremolo=gain(1-(config.lfo1Target==='amp'?config.lfo1Depth*.25:0)-(config.lfo2Target==='amp'?config.lfo2Depth*.25:0));amp.connect(tremolo).connect(input);
  const peak=config.volume*event.velocity*.45, attack=Math.min(duration,config.attack), attackLevel=peak*attack/config.attack;
  amp.gain.setValueAtTime(0,time);amp.gain.linearRampToValueAtTime(attackLevel,time+attack);
  let offLevel=attackLevel;
  if(duration>config.attack) { const decay=Math.min(config.decay,duration-config.attack);offLevel=peak*(1-(1-config.sustain)*decay/config.decay);amp.gain.linearRampToValueAtTime(offLevel,time+config.attack+decay); }
  amp.gain.setValueAtTime(offLevel,off);amp.gain.linearRampToValueAtTime(0,end);
  const filter1=own(context.createBiquadFilter()), filter2=own(context.createBiquadFilter());
  const cutoff=Math.max(20,Math.min(context.sampleRate*.45,config.cutoff*(1+config.velocityFilter*event.velocity*3)));
  for(const filter of [filter1,filter2]) {
    filter.type=config.filterType;filter.Q.value=config.resonance/2;
    const elevated=Math.max(20,Math.min(context.sampleRate*.45,cutoff*2**(config.filterEnv*5)));
    filter.frequency.setValueAtTime(cutoff,time);filter.frequency.exponentialRampToValueAtTime(elevated,time+Math.min(config.attack,duration/2));
    filter.frequency.exponentialRampToValueAtTime(cutoff,off);
  }
  const mix=own(context.createGain());mix.connect(filter1);filter1.connect(filter2);
  if(config.drive>0) { const drive=own(context.createWaveShaper()), curve=new Float32Array(256), amount=1+config.drive*30;for(let i=0;i<256;i++)curve[i]=Math.tanh((i/127.5-1)*amount)/Math.tanh(amount);drive.curve=curve;filter2.connect(drive).connect(amp); } else filter2.connect(amp);
  const pitchEnv=own(context.createConstantSource());pitchEnv.offset.setValueAtTime(config.pitchEnv*100,time);pitchEnv.offset.linearRampToValueAtTime(0,time+config.pitchDecay);sources.push(pitchEnv);
  const allOscillators: OscillatorNode[]=[];
  for(let voice=0;voice<config.voices;voice++) {
    const spread=config.voices===1?0:voice/(config.voices-1)*2-1;
    const pan=own(context.createStereoPanner());pan.pan.value=spread*config.spread;pan.connect(mix);
    const fmGain=config.fm>0?gain(frequency*config.fm*2):null; if(fmGain)oscillator('sine',frequency*config.fmRatio).connect(fmGain);
    for(const [wave,level,detune] of [[config.osc1,1-config.mix,0],[config.osc2,config.mix,config.detune]] as const) {
      const osc=oscillator(wave,frequency), levelNode=gain(level/config.voices);
      osc.detune.value=detune+spread*config.unisonDetune;pitchEnv.connect(osc.detune);fmGain?.connect(osc.frequency);allOscillators.push(osc);
      if(config.glide>0&&previousMidi!==undefined) { osc.frequency.setValueAtTime(Math.min(context.sampleRate*.4,440*2**((previousMidi-69)/12)),time);osc.frequency.exponentialRampToValueAtTime(frequency,time+config.glide); }
      osc.connect(levelNode).connect(pan);
    }
  }
  if(config.sub>0) { const sub=oscillator('sine',frequency/2);pitchEnv.connect(sub.detune);allOscillators.push(sub);sub.connect(gain(config.sub)).connect(mix); }
  if(config.noise>0) { const noise=own(context.createBufferSource());noise.buffer=noiseBuffer(context,config.noiseType==='metal');noise.loop=true;sources.push(noise);noise.connect(gain(config.noise)).connect(mix); }
  for(const id of [1,2] as const) {
    const depth=config[`lfo${id}Depth`];if(depth===0)continue;
    const lfo=oscillator(config[`lfo${id}Wave`],config[`lfo${id}Rate`]), target=config[`lfo${id}Target`];
    const modulation=gain(depth*(target==='pitch'?1200:target==='filter'?cutoff*.8:.25));lfo.connect(modulation);
    if(target==='pitch')for(const osc of allOscillators)modulation.connect(osc.detune);
    else if(target==='filter'){modulation.connect(filter1.frequency);modulation.connect(filter2.frequency);}
    else modulation.connect(tremolo.gain);
  }
  return {nodes,sources,end,midi,pitchOscillators:allOscillators};
}
export const defaultSynth = INIT_SYNTH;
