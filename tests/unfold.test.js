import test from 'node:test';
import assert from 'node:assert/strict';
import {performedOrder} from '../frontend/unfold.js';

const plain={repeatStart:false,repeatEnd:0,ending:null,endingStop:false};
const bars=(...specs)=>specs.map(s=>({...plain,...s}));
const walk=measures=>performedOrder(measures).map(({index,pass})=>`${index}${pass>1?'.'+pass:''}`).join(' ');

test('a closing repeat plays the section again, counting passes for verses',()=>{
 assert.equal(walk(bars({},{repeatEnd:2},{})),'0 1 0.2 1.2 2');
 assert.equal(walk(bars({},{repeatStart:true},{repeatEnd:3},{})),'0 1 2 1.2 2.2 1.3 2.3 3');
});

test('volta endings choose the ending for each pass',()=>{
 assert.equal(walk(bars({repeatStart:true},{},{ending:[1],repeatEnd:2,endingStop:true},{ending:[2],endingStop:true},{})),'0 1 2 0.2 1.2 3.2 4');
 assert.equal(walk(bars({},{ending:[1,2],repeatEnd:3,endingStop:true},{ending:[3],endingStop:true})),'0 1 0.2 1.2 0.3 2.3');
 // A later repeat starts after the finished volta group, not at the top.
 assert.equal(walk(bars({},{ending:[1],repeatEnd:2,endingStop:true},{ending:[2],endingStop:true},{},{repeatEnd:2})),'0 1 0.2 2.2 3 4 3.2 4.2');
});

test('D.C. al Fine and D.S. al Coda jump once and skip repeats afterwards',()=>{
 assert.equal(walk(bars({},{repeatEnd:2,fine:true},{dacapo:true})),'0 1 0.2 1.2 2 0 1');
 assert.equal(walk(bars({},{segno:true},{tocoda:true},{dalsegno:true},{coda:true},{})),'0 1 2 3 1 2 4 5');
 assert.equal(walk(bars({},{ending:[1],repeatEnd:2,endingStop:true},{ending:[2],endingStop:true},{dacapo:true})),'0 1 0.2 2.2 3 0 2 3','after D.C. only the last ending plays');
});

test('malformed jumps fail with a reason instead of guessing',()=>{
 assert.throws(()=>performedOrder(bars({},{dalsegno:true})),/D\.S\. has no segno/);
 assert.throws(()=>performedOrder(bars({ending:[1]},{})),/never closes/);
 assert.throws(()=>performedOrder(bars({coda:true},{segno:true},{tocoda:true},{dalsegno:true})),/no coda after it/);
 assert.throws(()=>performedOrder(Array.from({length:600},(_,i)=>({...plain,repeatEnd:i%2?8:0}))),/too long/);
});
