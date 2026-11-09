import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerificationStore} from '../lib/verification.js';
import {createReporter} from '../frontend/observation.js';
const payload={runId:'12345678-1234-1234-1234-123456789012',freshSamples:3,cursorAdvances:3,pauses:1,seeks:1,trackChanges:1,safeStops:1};
test('verification is subject-scoped, requires a complete observed sequence and expires',()=>{
 let at=10000;const store=createVerificationStore(()=>at);
 assert.equal(store.read('owner').status,'unobserved');store.record('owner',payload);
 assert.equal(store.read('owner').checks.complete,false);at+=4000;store.record('owner',{...payload,freshSamples:4});
 assert.equal(store.read('owner').checks.complete,true);assert.equal(store.read('another-user').runs.length,0);
 at+=31*60*1000;assert.equal(store.read('owner').status,'unobserved');
});
test('private media or credential fields and decreasing counters are rejected',()=>{
 const store=createVerificationStore();
 for(const extra of [{trackId:'private'},{token:'secret'},{title:'private'}])assert.throws(()=>store.record('owner',{...payload,...extra}),/content-free/);
 assert.throws(()=>store.record('owner',{...payload,seeks:-1}),/content-free/);
 store.record('owner',payload);assert.throws(()=>store.record('owner',{...payload,freshSamples:1}),/backward/);
});
test('reporter sends counters, never names, IDs, scores or tokens; records stops and transitions',async()=>{
 let at=10000;const sent=[];const report=createReporter(async data=>sent.push(data),{now:()=>at,newRun:()=>payload.runId});
 const sample=(id,progress,playing,receivedAt)=>({item:{id,name:'Private title'},progress_ms:progress,is_playing:playing,receivedAt});
 report.playback(sample('secret-id',0,true,0));report.follow({following:true,index:0,playing:true});await report.flush();await new Promise(r=>setImmediate(r));
 at+=6000;report.playback(sample('secret-id',6000,true,6000));report.follow({following:true,index:1,playing:true});
 report.follow({following:true,index:2,playing:true});report.follow({following:true,index:3,playing:true});
 report.playback(sample('secret-id',1000,false,7000));report.playback(sample('different-private-id',0,true,8000));report.follow({following:false});
 await new Promise(r=>setImmediate(r));at+=6000;await report.flush();
 const last=sent.at(-1);assert.equal(last.cursorAdvances,3);assert.equal(last.pauses,1);assert.equal(last.seeks,1);assert.equal(last.trackChanges,1);assert.equal(last.safeStops,1);
 assert.equal(Object.keys(last).length,9);assert.equal(JSON.stringify(last).includes('secret-id'),false);assert.equal(JSON.stringify(last).includes('Private'),false);
});
test('no preview reports, and account reset invalidates delivery state',async()=>{
 let finish,run=0;const report=createReporter(()=>new Promise(resolve=>{finish=resolve;}),{newRun:()=>`12345678-1234-1234-1234-${String(++run).padStart(12,'0')}`});
 await report.flush();assert.equal(report.delivery(),'idle');
 report.playback({item:{id:'fixture'},progress_ms:0,is_playing:true,receivedAt:0});const pending=report.flush();report.reset();finish();await pending;
 assert.equal(report.delivery(),'idle');assert.match(report.runId(),/000000000002$/);
});
test('Learn notes counts are optional, monotonic and shown across accounts only as met checks',()=>{
 let at=10000;const store=createVerificationStore(()=>at);
 store.record('owner',payload);assert.equal(store.read('owner').runs[0].learnFrames,0,'older pages omit learn counters');
 store.record('owner',{...payload,learnFrames:120,learnedNotes:0});assert.equal(store.read('owner').checks.learning,false,'listening that learned nothing does not count');
 store.record('owner',{...payload,learnFrames:150,learnedNotes:3});
 assert.equal(store.read('owner').checks.learning,true);
 assert.throws(()=>store.record('owner',{...payload,learnFrames:10,learnedNotes:3}),/backward/);
 assert.throws(()=>store.record('owner',{...payload,learnFrames:1.5}),/content-free/);
 const other=store.read('agent');
 assert.deepEqual(other.runs,[],'other accounts see no runs');
 assert.equal(other.all.accounts,1);assert.equal(other.all.checks.learning,true);assert.equal(other.checks.learning,false);
 assert.equal(JSON.stringify(other).includes('owner'),false,'no account names');
});
test('reporter adds learned frames and notes',async()=>{
 const sent=[];let at=0;const report=createReporter(async data=>sent.push(data),{now:()=>at+=6000,newRun:()=>payload.runId});
 report.playback({item:{id:'x'},progress_ms:0,is_playing:true,receivedAt:0});
 report.learn({frames:60});await new Promise(r=>setImmediate(r));report.learn({frames:50,notes:4});report.learn({notes:-2});await new Promise(r=>setImmediate(r));await report.flush();
 assert.equal(sent.at(-1).learnFrames,110);assert.equal(sent.at(-1).learnedNotes,4,'forgotten notes never lower the count');
});
