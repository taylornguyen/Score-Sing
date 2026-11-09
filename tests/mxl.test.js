import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {inspectScoreArchive,readScoreFile} from '../frontend/score-file.js';
const manifest=strToU8('<container><rootfiles><rootfile full-path="scores/voice.musicxml"/></rootfiles></container>');
const notation=strToU8('<score-partwise version="4.0"/>');
const zip=extra=>zipSync({'META-INF/container.xml':manifest,'scores/voice.musicxml':notation,...extra});
test('standard compressed container retains only manifest until score selected',async()=>{
 const a=await inspectScoreArchive(zip({'cover.png':new Uint8Array(100)}));assert.deepEqual(a.manifest,manifest);assert.deepEqual(a.extract('scores/voice.musicxml'),notation);assert.throws(()=>a.extract('missing.xml'),/missing or invalid/);
});
test('corrupt and missing-manifest archives fail visibly',async()=>{
 await assert.rejects(inspectScoreArchive(new Uint8Array([1,2,3])),/damaged or unsupported/);
 await assert.rejects(inspectScoreArchive(zipSync({'voice.xml':notation})),/missing META-INF/);
});
test('archive path traversal and oversized expansion are rejected before extraction',async()=>{
 await assert.rejects(inspectScoreArchive(zip({'../outside.xml':notation})),/file path/);
 await assert.rejects(inspectScoreArchive(zip({'huge.xml':new Uint8Array(5_000_001)})),/supported size/);
});
test('archive entry count is bounded',async()=>{
 const extra={};for(let i=0;i<130;i++)extra[`item${i}.txt`]=new Uint8Array(1);
 await assert.rejects(inspectScoreArchive(zip(extra)),/supported size/);
});
test('plain and JSON score imports remain unchanged; source size checked first',async()=>{
 assert.equal(await readScoreFile({name:'score.musicxml',size:notation.length,text:async()=>'<score-partwise/>'}),'<score-partwise/>');
 assert.equal(await readScoreFile({name:'score.json',size:2,text:async()=>'{}'}),'{}');
 await assert.rejects(readScoreFile({name:'huge.mxl',size:5_000_001}),/under 5 MB/);
});
function forgeSize(bytes,name,size,both=false){
 const result=bytes.slice(),view=new DataView(result.buffer);let pos=0;
 while(pos<result.length-46){
  if(view.getUint32(pos,true)===0x02014b50){
   const length=view.getUint16(pos+28,true);const found=new TextDecoder().decode(result.subarray(pos+46,pos+46+length));
   if(found===name){view.setUint32(pos+24,size,true);if(both)view.setUint32(view.getUint32(pos+42,true)+22,size,true);return result;}
  }pos++;
 }throw Error('Test fixture central entry not found');
}
test('forged ZIP declared sizes cannot truncate an oversized but playable score',async()=>{
 const content=strToU8('<score-partwise/>'+ ' '.repeat(6_000_000));const original=zip({'scores/voice.musicxml':content});
 await assert.rejects(inspectScoreArchive(forgeSize(original,'scores/voice.musicxml',16)),/damaged or unsupported/);
 const archive=await inspectScoreArchive(forgeSize(original,'scores/voice.musicxml',16,true));
 assert.throws(()=>archive.extract('scores/voice.musicxml'),/decoded size/);
});
test('corrupt CRC cannot be accepted as valid notation',async()=>{
 const bytes=zip();const view=new DataView(bytes.buffer);let pos=0;
 while(pos<bytes.length-46){
  if(view.getUint32(pos,true)===0x02014b50){
   const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+view.getUint16(pos+28,true)));
   if(name==='scores/voice.musicxml'){view.setUint32(pos+16,0,true);view.setUint32(view.getUint32(pos+42,true)+14,0,true);break;}
  }pos++;
 }
 const archive=await inspectScoreArchive(bytes);assert.throws(()=>archive.extract('scores/voice.musicxml'),/checksum/);
});
