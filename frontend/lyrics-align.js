// Aligns a score's sung words to a recording's time-synced lyric lines.
// autoAlign(entries, lines) -> {checkpoints, confidence, anchors}; throws with a reason when the lyrics do not fit.
// entries: score positions in order, each {at: whole-note time, lyric?: first-verse syllable, wordStart?: boolean}.
// lines: [{seconds, text}] sorted by time (see lrclib.js). Checkpoints use the format in sync.js.
import {interpolateCues} from './sync.js';

// Below this share of score words found in the recording's lyrics, the score is probably another song or arrangement.
export const MIN_CONFIDENCE=0.45;
const MIN_ANCHORS=3,MATCH=2,NEAR=1,GAP=-0.6,LINE_SHARE=0.5;

export function normalizeWord(word){
 return String(word).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

export function scoreWords(entries){
 const words=[];let current=null;
 entries.forEach((entry,index)=>{
  const text=entry.lyric?.trim();
  if(!text)return;
  const continues=current&&entry.wordStart===false;
  if(continues){current.text+=text.replace(/^-/,'');return;}
  current={text:text.replace(/-$/,''),index};words.push(current);
 });
 return words.map(w=>({...w,token:normalizeWord(w.text)})).filter(w=>w.token);
}

export function lyricWords(lines){
 const words=[];
 lines.forEach((line,lineIndex)=>{
  const tokens=line.text.split(/[\s‐-―-]+/).map(normalizeWord).filter(Boolean);
  tokens.forEach((token,position)=>words.push({token,lineIndex,position,count:tokens.length}));
 });
 return words;
}

function similar(a,b){
 if(a===b)return MATCH;
 if(Math.min(a.length,b.length)<4)return -Infinity;
 // One edit apart (for example "lovin"/"loving") still counts as the same sung word.
 let i=0;while(i<a.length&&a[i]===b[i])i++;
 let j=0;while(j<a.length-i&&j<b.length-i&&a[a.length-1-j]===b[b.length-1-j])j++;
 return Math.max(a.length,b.length)-i-j<=1?NEAR:-Infinity;
}

// Semi-global alignment: unmatched words at either end are free, inner gaps cost GAP.
// Up to MERGE score words may join to one sung word, for scores that mark syllables as separate words.
const MERGE=3;
function align(score,sung){
 const n=score.length,m=sung.length,width=m+1;
 const best=new Float64Array((n+1)*width),move=new Uint8Array((n+1)*width);
 for(let j=1;j<=m;j++)move[j]=2;
 for(let i=1;i<=n;i++){
  move[i*width]=1;
  for(let j=1;j<=m;j++){
   let value=best[(i-1)*width+j]+(j===m?0:GAP),step=1;
   const left=best[i*width+j-1]+(i===n?0:GAP);if(left>value){value=left;step=2;}
   let joined='';
   for(let k=1;k<=MERGE&&k<=i;k++){
    joined=score[i-k].token+joined;
    const pair=similar(joined,sung[j-1].token);
    if(pair>-Infinity){const diagonal=best[(i-k)*width+j-1]+pair*(k===1?1:0.9);if(diagonal>value){value=diagonal;step=2+k;}}
   }
   best[i*width+j]=value;move[i*width+j]=step;
  }
 }
 const pairs=[];
 for(let i=n,j=m;i>0||j>0;){
  const step=move[i*width+j];
  if(step>2){const k=step-2;pairs.push([i-k,j-1,k]);i-=k;j--;}else if(step===1)i--;else j--;
 }
 return pairs.reverse();
}

const matchedShare=(score,pairs)=>pairs.reduce((sum,[,,k])=>sum+k,0)/score.length;
// Share of the score's sung words found in the recording's lyrics, for choosing between scores before timing one.
export function lyricsMatch(entries,lines){
 const score=scoreWords(entries),sung=lyricWords(lines);
 return score.length<MIN_ANCHORS||!sung.length?0:matchedShare(score,align(score,sung));
}

export function autoAlign(entries,lines){
 if(!Array.isArray(entries)||entries.length<2)throw Error('This score is too short to align');
 const times=entries.map(e=>e.at);
 const score=scoreWords(entries);
 if(score.length<MIN_ANCHORS)throw Error('This score has no lyrics to line up with the recording');
 const sung=lyricWords(lines);
 if(!sung.length)throw Error('The recording’s lyrics are empty');
 const pairs=align(score,sung);
 const confidence=matchedShare(score,pairs);
 // A line anchors timing when its first word matched and most of its words matched.
 const perLine=new Map();
 for(const [s,l] of pairs){const w=sung[l];const entry=perLine.get(w.lineIndex)||{matched:0,first:null};entry.matched++;if(w.position===0)entry.first=score[s].index;perLine.set(w.lineIndex,entry);}
 const anchors=[];
 for(const [lineIndex,{matched,first}] of [...perLine].sort((a,b)=>a[0]-b[0])){
  const line=lines[lineIndex],count=sung.find(w=>w.lineIndex===lineIndex).count;
  if(first===null||matched/count<LINE_SHARE)continue;
  const last=anchors.at(-1);
  if(last&&(first<=last.index||line.seconds<=last.seconds))continue;
  anchors.push({index:first,seconds:line.seconds});
 }
 if(confidence<MIN_CONFIDENCE||anchors.length<MIN_ANCHORS)
  throw Error(`The recording’s lyrics don’t match this score well enough (${Math.round(confidence*100)}% of words, ${anchors.length} lines)`);
 const checkpoints=[...anchors];
 const rate=(a,b)=>(b.seconds-a.seconds)/(times[b.index]-times[a.index]);
 if(checkpoints[0].index!==0){
  const [a,b]=checkpoints,seconds=Math.max(0,a.seconds-(times[a.index]-times[0])*rate(a,b));
  if(seconds<a.seconds)checkpoints.unshift({index:0,seconds});else checkpoints[0]={index:0,seconds:a.seconds};
 }
 const lastIndex=entries.length-1;
 if(checkpoints.at(-1).index!==lastIndex){
  const a=checkpoints.at(-2),b=checkpoints.at(-1);
  checkpoints.push({index:lastIndex,seconds:b.seconds+(times[lastIndex]-times[b.index])*rate(a,b)});
 }
 const rounded=checkpoints.map(p=>({index:p.index,seconds:Math.round(p.seconds*1000)/1000}));
 interpolateCues(times,rounded);
 return {checkpoints:rounded,confidence:Math.round(confidence*100)/100,anchors:anchors.length};
}
