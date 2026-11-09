import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPitch,compare} from '../frontend/pitch.js';
const rate=48000;
function tone(hz,{harmonics=[1],noise=0,length=2048,amp=0.3}={}){
 let seed=7;const rand=()=>((seed=(seed*16807)%2147483647)/2147483647-0.5);
 return Float32Array.from({length},(_,i)=>harmonics.reduce((s,h,k)=>s+amp*h*Math.sin(2*Math.PI*hz*(k+1)*i/rate),0)+noise*rand());
}
const cents=(a,b)=>1200*Math.log2(a/b);
test('sine tones across voice ranges are within 5 cents',()=>{
 for(const hz of [82.41,130.81,196,261.63,440,659.25,987.77]){const r=detectPitch(tone(hz),rate);assert.ok(r,`detects ${hz}`);assert.ok(Math.abs(cents(r.hz,hz))<5,`${hz} → ${r.hz}`);}
});
test('harmonic-rich voice-like tone reports its fundamental, not an overtone',()=>{
 const r=detectPitch(tone(220,{harmonics:[0.5,1,0.6,0.3]}),rate);assert.ok(Math.abs(cents(r.hz,220))<10,String(r.hz));
});
test('moderate noise still finds the pitch; silence and pure noise give no reading',()=>{
 assert.ok(Math.abs(cents(detectPitch(tone(330,{noise:0.08}),rate).hz,330))<10);
 assert.equal(detectPitch(new Float32Array(2048),rate),null);
 assert.equal(detectPitch(tone(330,{amp:0,noise:0.5}),rate),null);
});
test('compare folds octaves, picks the nearest chord tone and classifies tuning',()=>{
 assert.deepEqual(compare(440,[69]),{cents:0,state:'in-tune'});
 assert.equal(compare(220,[69]).state,'in-tune','an octave lower is the same note for a lower voice');
 assert.equal(compare(440*2**(40/1200),[69]).state,'sharp');
 assert.equal(compare(440*2**(-60/1200),[69]).cents,-60);
 assert.equal(compare(440*2**(-60/1200),[69]).state,'flat');
 assert.equal(compare(329.63,[60,64,67]).state,'in-tune','E against a C major chord');
 assert.equal(compare(440,[]),null);assert.equal(compare(0,[69]),null);
});
