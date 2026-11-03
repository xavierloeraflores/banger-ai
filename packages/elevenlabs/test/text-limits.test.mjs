import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLyrics,chunkTextSchema,planSchema,providerPlanSchema,lyricEditSchema,lyricEditError,ElevenMusic} from '../dist/index.js';

const planWith = text => ({chunks:[{text,durationMs:4000,positiveStyles:['piano']}]});
const lines = count => Array(count).fill('a'.repeat(200)).join('\n');

test('chunk text accepts 200 characters per line and 30 lines, not 200 per section',()=>{
  for (const text of [lines(30), '[Verse]\n'+lines(29), '[Verse]\n{guitar solo}\n'+lines(28), '😀'.repeat(200), lines(30).replaceAll('\n','\r\n')]) {
    assert.equal(chunkTextSchema.parse(text),text);
    assert.equal(planSchema.parse(planWith(text)).chunks[0].text,text);
    assert.equal(providerPlanSchema.parse(planWith(text)).chunks[0].text,text);
  }
  for (const text of ['a'.repeat(201), '😀'.repeat(201), lines(31), '[Verse]\n'+lines(30), '[Verse]\n{solo}\n'+lines(29), lines(30)+'\n']) {
    assert.equal(chunkTextSchema.safeParse(text).success,false);
    assert.equal(planSchema.safeParse(planWith(text)).success,false);
    assert.equal(providerPlanSchema.safeParse(planWith(text)).success,false);
  }
});

test('total character ceiling is 6,132, independently of the stricter line limits',()=>{
  // Line limits cap ordinary LF text below the total ceiling. Check the total
  // issue independently so a future line-validation change cannot loosen it.
  const totalIssue = text => chunkTextSchema.safeParse(text).error.issues.some(issue=>issue.message.includes('6,132'));
  assert.equal(totalIssue('a'.repeat(6132)),false);
  assert.equal(totalIssue('a'.repeat(6133)),true);
  assert.equal(totalIssue('😀'.repeat(6132)),false);
  assert.equal(totalIssue('😀'.repeat(6133)),true);
  assert.equal(chunkTextSchema.safeParse('['+'s'.repeat(100)+']').success,true);
  assert.equal(chunkTextSchema.safeParse('['+'s'.repeat(101)+']').success,false);
  assert.equal(chunkTextSchema.safeParse('[]').success,false);
});

test('lyric edit requests enforce line lengths and reject embedded labels or directions',()=>{
  assert.equal(lyricEditSchema.safeParse({index:0,lyrics:lines(30)}).success,true);
  for (const lyrics of ['a'.repeat(201),lines(31),'[Verse]\nwords','words {solo}','a'.repeat(6133)]) {
    assert.equal(lyricEditSchema.safeParse({index:0,lyrics}).success,false);
  }
});

test('assembled edits count every retained label and direction and keep the original immutable',()=>{
  for (const [text, available] of [['original',30],['[Verse]\noriginal',29],['[Verse]\n{solo}\n{drums}\noriginal',27]]) {
    const plan=planWith(text),before=globalThis.structuredClone(plan);
    const lyrics=lines(available);
    const edited=applyLyrics(plan,[{index:0,lyrics}]);
    assert.equal(edited.chunks[0].text.split('\n').length,30);
    assert.equal(lyricEditError(text,lyrics),undefined);
    assert.match(lyricEditError(text,lyrics+'\nextra'),/30 lines/);
    assert.throws(()=>applyLyrics(plan,[{index:0,lyrics:lyrics+'\nextra'}]),/30 lines/);
    assert.deepEqual(plan,before);
  }
  assert.equal(applyLyrics(planWith('[Verse]\n{solo}\nwords'),[{index:0,lyrics:''}]).chunks[0].text,'[Verse]\n{solo}');
  assert.match(lyricEditError('[Verse]\n{'+ 'x'.repeat(199)+'}\nwords','new'),/200 characters/);
  assert.throws(()=>applyLyrics(planWith('[Verse]\n{'+ 'x'.repeat(199)+'}\nwords'),[{index:0,lyrics:'new'}]),/200 characters/);
});

test('generated lyric proposals are validated before extraction and after restoring directions',async()=>{
  const apiFor = text => new ElevenMusic('fixture-key',{fetch:async()=>globalThis.Response.json({chunks:[{text,duration_ms:4000,positive_styles:['piano']}]})});
  const plan=planWith('[Verse]\n{solo}\n{drums}\noriginal'),before=globalThis.structuredClone(plan);
  await assert.rejects(()=>apiFor('[Verse]\n'+'a'.repeat(201)).lyrics(plan,'new',[0]),/200 characters/);
  await assert.rejects(()=>apiFor('[Verse]\n'+lines(30)).lyrics(plan,'new',[0]),/30 lines/);
  await assert.rejects(()=>apiFor('[Verse]\n'+lines(28)).lyrics(plan,'new',[0]),/30 lines/);
  const result=await apiFor('[Verse]\n'+lines(27)).lyrics(plan,'new',[0]);
  assert.equal(result.chunks[0].text,'[Verse]\n{solo}\n{drums}\n'+lines(27));
  assert.deepEqual(plan,before);
});

test('invalid saved generation text is rejected before a provider request',async()=>{
  let requests=0;
  const api=new ElevenMusic('fixture-key',{fetch:async()=>{requests++;throw new Error('unexpected request');}});
  const plan=planWith('[Verse]\n'+'a'.repeat(201));
  await assert.rejects(()=>api.generate({plan,songId:'saved'},[0]),/200 characters/);
  await assert.rejects(()=>api.lyrics(plan,'new',[0]),/200 characters/);
  assert.equal(requests,0);
});
