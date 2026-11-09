import test from 'node:test';
import assert from 'node:assert/strict';
import {lyricsMatch,autoAlign,scoreWords,normalizeWord,MIN_CONFIDENCE} from '../frontend/lyrics-align.js';
import {interpolateCues} from '../frontend/sync.js';
// One score position per syllable, a quarter note apart; "Hap-py" style words continue with wordStart:false.
function score(text){
 const entries=[];
 for(const word of text.split(/\s+/)){
  const parts=word.split('-');
  parts.forEach((part,i)=>entries.push({at:entries.length/4,lyric:part,wordStart:i===0}));
 }
 return entries;
}
const verse='Twin-kle twin-kle lit-tle star how I won-der what you are';
const chorus='Up a-bove the world so high like a dia-mond in the sky';
const lrc=(rows)=>rows.map(([seconds,text])=>({seconds,text}));
test('words join syllables and normalize punctuation and accents',()=>{
 assert.deepEqual(scoreWords(score('Hap-py birth-day')).map(w=>w.token),['happy','birthday']);
 assert.equal(normalizeWord('Café,'),'cafe');assert.equal(normalizeWord("Don't"),'dont');
});
test('matching lyrics produce increasing checkpoints covering the whole score',()=>{
 const entries=score(`${verse} ${chorus}`);
 const result=autoAlign(entries,lrc([[10,'Twinkle, twinkle, little star'],[14,'How I wonder what you are'],[18,'Up above the world so high'],[22,'Like a diamond in the sky']]));
 assert.equal(result.confidence,1);assert.equal(result.anchors,4);
 assert.deepEqual(result.checkpoints.slice(0,2),[{index:0,seconds:10},{index:7,seconds:14}]);
 assert.equal(result.checkpoints.at(-1).index,entries.length-1);
 const cues=interpolateCues(entries.map(e=>e.at),result.checkpoints);
 assert.ok(cues.every((t,i)=>!i||t>cues[i-1]));
});
test('a recording that repeats choruses beyond the score still aligns to the first pass',()=>{
 const entries=score(`${verse} ${chorus}`);
 const result=autoAlign(entries,lrc([[5,'Oh yeah'],[10,'Twinkle twinkle little star'],[14,'How I wonder what you are'],[18,'Up above the world so high'],[22,'Like a diamond in the sky'],[30,'Twinkle twinkle little star'],[34,'How I wonder what you are']]));
 assert.equal(result.checkpoints[0].seconds,10);
 assert.ok(result.checkpoints.every((p,i,all)=>!i||(p.index>all[i-1].index&&p.seconds>all[i-1].seconds)));
});
test('the first and last positions are extrapolated from the neighbouring tempo',()=>{
 const entries=[{at:0},{at:0.25},...score(verse).map(e=>({...e,at:e.at+0.5})),{at:4}];
 const result=autoAlign(entries,lrc([[10,'Twinkle twinkle'],[12,'little star how I'],[15,'wonder what you are']]));
 assert.equal(result.checkpoints[0].index,0);assert.ok(result.checkpoints[0].seconds<10&&result.checkpoints[0].seconds>=0);
 assert.equal(result.checkpoints.at(-1).index,entries.length-1);
});
test('another song or a score without lyrics is refused with a reason',()=>{
 assert.throws(()=>autoAlign(score(`${verse} ${chorus}`),lrc([[1,'Is this the real life'],[5,'Is this just fantasy'],[9,'Caught in a landslide']])),/don’t match this score/);
 assert.throws(()=>autoAlign([{at:0},{at:1},{at:2}],lrc([[1,'a b'],[2,'c d']])),/no lyrics/);
 assert.ok(MIN_CONFIDENCE>0.3&&MIN_CONFIDENCE<0.7);
});
test('scores that split words into separate syllables still align',()=>{
 const entries='Joy ful joy ful we a dore Thee God of glo ry Lord of love Hearts un fold like flowers be fore Thee'.split(' ').map((lyric,i)=>({at:i/4,lyric,wordStart:true}));
 const result=autoAlign(entries,lrc([[3,'Joyful, joyful, we adore Thee'],[7,'God of glory, Lord of love'],[11,'Hearts unfold like flowers before Thee']]));
 assert.equal(result.confidence,1);assert.deepEqual(result.checkpoints.slice(0,3),[{index:0,seconds:3},{index:8,seconds:7},{index:15,seconds:11}]);
});
test('lyricsMatch scores how much of a score is sung in the recording',()=>{
 const lines=lrc([[3,'Joyful, joyful, we adore Thee'],[7,'God of glory, Lord of love']]);
 const words=text=>text.split(' ').map((lyric,i)=>({at:i,lyric,wordStart:true}));
 assert.equal(lyricsMatch(words('Joy ful joy ful we a dore Thee God of glo ry Lord of love'),lines),1);
 assert.equal(lyricsMatch(words('la la la la la la'),lines),0);
 assert.equal(lyricsMatch(words('Joy ful'),lines),0,'too few words to judge');
});
