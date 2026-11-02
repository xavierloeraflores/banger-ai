const ready = new WeakSet<BaseAudioContext>();
const pending = new WeakMap<BaseAudioContext, Promise<void>>();
export const SIDECHAIN_WORKLET_SOURCE = `class Sidechain extends AudioWorkletProcessor {
 static get parameterDescriptors() { return [
 {name:'threshold',defaultValue:-24,minValue:-100,maxValue:0},
 {name:'ratio',defaultValue:4,minValue:1,maxValue:20},
 {name:'attack',defaultValue:.01,minValue:0,maxValue:1},
 {name:'release',defaultValue:.1,minValue:0,maxValue:1},
 {name:'knee',defaultValue:20,minValue:0,maxValue:40} ]; }
 constructor() { super(); this.reduction=0; this.stopped=false; this.port.onmessage=()=>{this.stopped=true;}; }
 process(inputs,outputs,p) {
  if(this.stopped) return false;
  const input=inputs[0], key=inputs[1], out=outputs[0];
  const at=(name,i)=>p[name][p[name].length===1?0:i];
  for(let i=0;i<out[0].length;i++) {
   let level=0; for(const channel of key) level=Math.max(level,Math.abs(channel[i]||0));
   const db=20*Math.log10(Math.max(1e-9,level)), threshold=at('threshold',i), ratio=at('ratio',i), knee=at('knee',i), delta=db-threshold;
   let reduction=0;
   if(delta>knee/2) reduction=delta*(1-1/ratio);
   else if(knee>0 && delta>-knee/2) reduction=(1-1/ratio)*(delta+knee/2)**2/(2*knee);
   const seconds=at(reduction>this.reduction?'attack':'release',i), coefficient=seconds<=0?0:Math.exp(-1/(sampleRate*seconds));
   this.reduction=coefficient*this.reduction+(1-coefficient)*reduction;
   const gain=10**(-this.reduction/20);
   for(let ch=0;ch<out.length;ch++) out[ch][i]=(input[ch]?.[i]??input[0]?.[i]??0)*gain;
  } return true;
 }
} registerProcessor('banger-sidechain',Sidechain);`;
let configuredModuleUrl: string | undefined;
/** Set a trusted same-origin worklet asset URL before playback/export in CSP-restricted apps. */
export function configureAudioWorklet(url: string): void {
  if (!url.trim()) throw new TypeError('Audio worklet URL must not be empty');
  configuredModuleUrl = url;
}
/** Prepare the audio-rate envelope follower once per real-time or offline context. */
export function prepareAudio(context: BaseAudioContext, moduleUrl = configuredModuleUrl): Promise<void> {
  if (ready.has(context) || !context.audioWorklet) return Promise.resolve();
  let task = pending.get(context);
  if (!task) {
    const url = moduleUrl ?? URL.createObjectURL(new Blob([SIDECHAIN_WORKLET_SOURCE], { type: 'text/javascript' }));
    task = context.audioWorklet.addModule(url).then(() => { ready.add(context); }).finally(() => { if (!moduleUrl) URL.revokeObjectURL(url); pending.delete(context); }); pending.set(context, task);
  }
  return task;
}
export const hasSidechainWorklet = (context: BaseAudioContext): boolean => ready.has(context);
