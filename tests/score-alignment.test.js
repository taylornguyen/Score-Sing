import test from 'node:test';
import assert from 'node:assert/strict';
import {interpolateCues,validateCheckpoints,validateCues,cursorAt} from '../frontend/sync.js';
test('sparse recording checkpoints interpolate musical time, preserving expressive tempo changes',()=>{
 const times=[0,.25,.5,.75,1,1.5,2];
 const cues=interpolateCues(times,[{index:0,seconds:4},{index:4,seconds:12},{index:6,seconds:24}]);
 assert.deepEqual(cues,[4,6,8,10,12,18,24]);
 assert.equal(cursorAt(cues,17),4);
 assert.deepEqual(validateCues(JSON.parse(JSON.stringify(cues)),7),cues);
});
test('checkpoint timing requires both endpoints and strictly increasing recording and score positions',()=>{
 for(const points of [[],[{index:0,seconds:0}],[{index:1,seconds:1},{index:2,seconds:2}],[{index:0,seconds:1},{index:2,seconds:1}],[{index:0,seconds:3},{index:2,seconds:2}],[{index:-1,seconds:0},{index:2,seconds:2}],[{index:0,seconds:0},{index:0,seconds:2}],[{index:0,seconds:NaN},{index:2,seconds:2}]])assert.throws(()=>interpolateCues([0,.25,.5],points));
 assert.throws(()=>interpolateCues([0,0,.5],[{index:0,seconds:0},{index:2,seconds:2}]),/musical time/);
 assert.throws(()=>validateCheckpoints({},3));
 assert.throws(()=>validateCheckpoints([{index:4,seconds:2}],3));
 assert.throws(()=>validateCues([0,1],3));
});
