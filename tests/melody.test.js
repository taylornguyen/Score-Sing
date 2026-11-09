import test from 'node:test';
import assert from 'node:assert/strict';
import {framePitch,wordAt,createMelody} from '../frontend/melody.js';

const RATE=48000,SIZE=8192;
// AnalyserNode-style spectrum: Hann window, magnitude in dB.
function spectrum(samples){
 const n=samples.length,re=new Float64Array(n),im=new Float64Array(n);
 for(let i=0;i<n;i++)re[i]=samples[i]*(0.5-0.5*Math.cos(2*Math.PI*i/n));
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len;for(let i=0;i<n;i+=len)for(let k=0;k<len/2;k++){const c=Math.cos(a*k),s=Math.sin(a*k),xr=re[i+k+len/2]*c-im[i+k+len/2]*s,xi=re[i+k+len/2]*s+im[i+k+len/2]*c;re[i+k+len/2]=re[i+k]-xr;im[i+k+len/2]=im[i+k]-xi;re[i+k]+=xr;im[i+k]+=xi;}}
 return Float32Array.from({length:n/2},(_,i)=>20*Math.log10(Math.hypot(re[i],im[i])/n+1e-12));
}
const hz=midi=>440*2**((midi-69)/12);
let seed=7;const noise=()=>{seed=(seed*16807)%2147483647;return seed/2147483647-0.5;};
// A voice (rich harmonics, vibrato) over bass, a sustained chord and noise.
function mix(voice,chord,offset){
 return Float32Array.from({length:SIZE},(_,i)=>{
  // Vibrato of ±0.6% at 5.5 Hz, with the phase integrated so the pitch stays centred.
  const t=(offset+i)/RATE,phase=2*Math.PI*hz(voice)*(t+0.006*(1-Math.cos(2*Math.PI*5.5*t))/(2*Math.PI*5.5));
  let v=0;for(let h=1;h<=10;h++)v+=Math.sin(phase*h)/h;
  let a=0.7*Math.sin(2*Math.PI*hz(chord[0]-24)*t);for(const m of chord)a+=0.18*Math.sin(2*Math.PI*hz(m)*t)+0.06*Math.sin(4*Math.PI*hz(m)*t);
  return 0.3*v+0.3*a+0.05*noise();
 });
}
const melody=[[64,[48,52,55]],[62,[43,47,50]],[60,[48,52,55]],[67,[45,48,52]],[69,[41,45,48]],[65,[41,45,48]],[59,[43,47,50]],[72,[48,52,55]],[52,[40,44,47]],[57,[45,48,52]]];

test('the sung note wins over bass and chord in a mixed recording',()=>{
 let right=0;
 melody.forEach(([voice,chord],i)=>{const p=framePitch(spectrum(mix(voice,chord,i*SIZE)),RATE,SIZE);if(p&&p.midi===voice)right++;});
 assert.ok(right>=8,`${right} of ${melody.length} frames heard the melody`);
 assert.equal(framePitch(spectrum(Float32Array.from({length:SIZE},()=>0.05*noise())),RATE,SIZE),null,'noise has no pitch');
 assert.equal(framePitch(new Float32Array(SIZE/2).fill(-Infinity),RATE,SIZE),null,'silence has no pitch');
});

test('words take the note most frames agree on, octave slips included, and remember earlier listens',()=>{
 const words=[{text:'one',start:0,end:1},{text:'two',start:1,end:2},{text:'three',start:2.5,end:3}];
 assert.deepEqual([0,0.99,1,2.2,2.5,3].map(s=>wordAt(words,s)),[0,0,1,-1,2,-1]);
 const learner=createMelody(words);
 for(let f=0;f<6;f++)learner.add(0,{midi:f<4?64:52,share:0.1});// two octave slips
 for(let f=0;f<6;f++)learner.add(1,{midi:60+f,share:0.1});// no agreement
 for(let f=0;f<2;f++)learner.add(2,{midi:67,share:0.1});// too few frames
 learner.add(9,{midi:60,share:1});learner.add(0,null);
 assert.deepEqual(learner.pitches(),[64,null,null]);
 const again=createMelody(words,JSON.parse(JSON.stringify(learner)));
 for(let f=0;f<3;f++)again.add(2,{midi:67,share:0.1});
 assert.deepEqual(again.pitches(),[64,null,67],'a second listen adds to the first');
 assert.equal(again.learned(),2);
 assert.deepEqual(createMelody([{text:'other',start:0,end:1}],again.toJSON()).pitches(),[null],'other lyrics start fresh');
});

test('a wavering sung note beats a steadier backing note that won slightly more frames',()=>{
 const words=[{text:'hold',start:0,end:2}];
 const learner=createMelody(words);
 const frame=(midi,share,cents,other)=>({midi,share,candidates:[{midi,share,cents},other]});
 for(let f=0;f<5;f++)learner.add(0,frame(50,0.12,2,{midi:64,share:0.1,cents:f%2?12:-12}));// backing bass, steady
 for(let f=0;f<4;f++)learner.add(0,frame(64,0.1,f%2?12:-12,{midi:50,share:0.1,cents:2}));// voice with vibrato
 assert.deepEqual(learner.pitches(),[64]);
 const old=learner.toJSON();delete old.spread;
 assert.deepEqual(createMelody(words,old).pitches(),[50],'saves without spread still load, counting frames only');
 assert.deepEqual(createMelody(words,JSON.parse(JSON.stringify(learner))).pitches(),[64],'spread is kept between listens');
});

