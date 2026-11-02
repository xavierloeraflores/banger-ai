import type { SoundName } from '@banger/compiler';
function noise(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2147483648 - 1; };
}
export function createDrums(context: BaseAudioContext): Record<SoundName, AudioBuffer> {
  function sample(kind: 'kick' | 'snare' | 'hat', duration: number): AudioBuffer {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0), random = noise(42);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / context.sampleRate, white = random();
      const attack = Math.min(1, t / .002), release = Math.min(1, (data.length - 1 - i) / (context.sampleRate * .005));
      const sound = kind === 'kick' ? Math.sin(2 * Math.PI * (48 * t + 5 * (1 - Math.exp(-30 * t)))) * Math.exp(-12 * t) :
        kind === 'snare' ? (.7 * white + .3 * Math.sin(2 * Math.PI * 180 * t)) * Math.exp(-18 * t) :
        .35 * (white - previous) * Math.exp(-55 * t);
      data[i] = sound * attack * release;
      previous = white;
    }
    return buffer;
  }
  return { 'drums/kick': sample('kick', .5), 'drums/snare': sample('snare', .3), 'drums/hat': sample('hat', .12) };
}
export function createImpulse(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * 1.2), context.sampleRate);
  const random = noise(73);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = random() * (1 - i / data.length) ** 3;
  }
  return buffer;
}
