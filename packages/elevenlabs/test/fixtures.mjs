import {Buffer} from 'node:buffer';
export const fixturePlan={extra:{preserved:true},chunks:[{text:'[Verse]\nOriginal words',durationMs:4000,positiveStyles:['warm piano'],negativeStyles:['drums'],contextAdherence:'high'},{text:'[Chorus]\nOriginal chorus',durationMs:4000,positiveStyles:['strings'],contextAdherence:'high'}]};
export function wav(){
 const rate=8000,length=rate*8,bytes=Buffer.alloc(44+length*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(length*2,40);
 for(let i=0;i<length;i++)bytes.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*(i<length/2?220:330))*2000),44+i*2);
 return bytes;
}
export function fixtureProvider(){
 const calls={analyze:0,lyrics:0,generate:0};
 return {calls,async analyze(){calls.analyze++;return {songId:'original-song',plan:globalThis.structuredClone(fixturePlan)};},async lyrics(plan,_prompt,indices){calls.lyrics++;const next=globalThis.structuredClone(plan);for(const index of indices)next.chunks[index].text='[Chorus]\nThe morning lights our way';return next;},async generate(version){calls.generate++;return {songId:`generated-${calls.generate}`,plan:globalThis.structuredClone(version.plan),providerPlan:globalThis.structuredClone(version.plan),audio:Buffer.from('ID3fixture-audio')};}};
}
