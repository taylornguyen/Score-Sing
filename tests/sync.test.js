import test from 'node:test';
import assert from 'node:assert/strict';
import {position,scoreTime,cursorAt} from '../frontend/sync.js';
test('playhead advances only while playing and stops after stale data',()=>{
 const s={progress_ms:1000,receivedAt:100,is_playing:true};
 assert.equal(position(s,2100),3);assert.equal(position({...s,is_playing:false},2100),1);
 assert.equal(position(s,8101),null);assert.equal(position({...s,progress_ms:null},200),null);assert.equal(position(null,200),null);
});
test('a fresh seek replaces the projected playhead',()=>{
 assert.equal(position({progress_ms:60000,receivedAt:100,is_playing:true},1100),61);
 assert.equal(position({progress_ms:5000,receivedAt:1100,is_playing:false},1100),5);
});
test('score cursor handles pickup offset, pauses and backward seeks',()=>{
 assert.equal(scoreTime(8,120,10),-1);assert.equal(scoreTime(12,120,10),1);
 const t=[0,.25,.5,1];assert.equal(cursorAt(t,-1),-1);assert.equal(cursorAt(t,0),0);assert.equal(cursorAt(t,.3),1);assert.equal(cursorAt(t,1),3);assert.equal(cursorAt(t,.25),1);assert.equal(cursorAt([],2),-1);
});
test('recording-specific cues honor boundaries and invalid values',()=>{
 assert.equal(cursorAt([1.2,3.7,8.8],3.69),0);assert.equal(cursorAt([1.2,3.7,8.8],3.7),1);assert.equal(cursorAt([0],NaN),-1);
 assert.throws(()=>scoreTime(3,0,0));assert.throws(()=>scoreTime(3,120,-1));
});
