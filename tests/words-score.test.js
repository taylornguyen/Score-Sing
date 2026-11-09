import test from 'node:test';
import assert from 'node:assert/strict';
import {wordsScore,WORDS_BPM} from '../frontend/words-score.js';

const lines=[{seconds:2,text:'Say it & mean it'},{seconds:6.1,text:'Supercalifragilistic'},{seconds:30,text:'last line here'}];
const measures=xml=>[...xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)].map(m=>[...m[1].matchAll(/<duration>(\d+)<\/duration>/g)].reduce((a,d)=>a+Number(d[1]),0));
const notes=xml=>[...xml.matchAll(/<note>([\s\S]*?)<\/note>/g)].map(m=>m[1]);

test('words sit on a 16th grid at 60 BPM so each line starts at its recording time',()=>{
 const {xml,words:timed}=wordsScore(lines,{title:'Song <1>',durationMs:40000});
 assert.deepEqual(timed.map(w=>w.text),['Say','it','&','mean','it','Supercalifragilistic','last','line','here']);
 assert.ok(timed.every(w=>w.start*4%1===0&&w.end>w.start),'word times are on the score grid');
 assert.equal(WORDS_BPM,60);
 assert.match(xml,/<score-partwise[\s>]/);assert.match(xml,/<work-title>Song &lt;1&gt;<\/work-title>/);
 assert.ok(measures(xml).every(total=>total===16),'every 4/4 measure is full');
 const words=[...xml.matchAll(/<text>([^<]*)<\/text>/g)].map(m=>m[1]);
 assert.deepEqual(words,['Say','it','&amp;','mean','it','Supercalifragilistic','last','line','here']);
 let at=0;const starts=[];
 for(const n of notes(xml)){const word=n.match(/<text>([^<]*)/)?.[1];if(word)starts.push([word,at/4]);at+=Number(n.match(/<duration>(\d+)/)[1]);}
 assert.deepEqual(starts.filter(([w])=>['Say','Supercalifragilistic','last'].includes(w)),[['Say',2],['Supercalifragilistic',6],['last',30]],'line starts land on the nearest 0.25 s');
 assert.ok(notes(xml).some(n=>n.includes('<tied type="start"/>')),'words crossing a barline are tied');
 assert.ok(notes(xml).every(n=>!n.includes('<pitch>')),'no invented pitches');
});

test('words-only scores refuse lyrics they cannot place',()=>{
 assert.throws(()=>wordsScore([{seconds:1,text:'one'}]),/too few timed lines/);
 assert.throws(()=>wordsScore([{seconds:1,text:'a'},{seconds:2,text:'b'}]),/too few words/);
});

test('learned notes are written as pitches; words with no learned note keep an x notehead',()=>{
 const pitches=[64,62,null,60,60,67,null,null,57];
 const {xml}=wordsScore(lines,{durationMs:40000,pitches});
 const sung=notes(xml).filter(n=>n.includes('<lyric'));
 assert.equal(sung.length,9);
 assert.match(sung[0],/<step>E<\/step><octave>4<\/octave>/);
 assert.match(sung[5],/<step>G<\/step><octave>4<\/octave>/);
 assert.match(sung[2],/<notehead>x<\/notehead>/,'unknown note is marked');
 assert.ok(!sung[0].includes('<notehead>'));
 assert.match(xml,/<clef><sign>G<\/sign><line>2<\/line><clef-octave-change>-1<\/clef-octave-change><\/clef>/,'a tenor range reads an octave down');
 assert.match(wordsScore(lines,{durationMs:40000,pitches:pitches.map(m=>m&&m+12)}).xml,/<clef><sign>G<\/sign><line>2<\/line><\/clef>/);
 assert.ok(!xml.includes('percussion'));
 assert.match(wordsScore(lines,{durationMs:40000,pitches:pitches.map(m=>m&&m-24)}).xml,/<sign>F<\/sign>/,'low voices get a bass clef');
 assert.throws(()=>wordsScore(lines,{pitches:[60]}),/do not match/);
 assert.throws(()=>wordsScore(lines,{pitches:pitches.map(()=>200)}),/do not match/);
});
