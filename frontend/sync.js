import {unfoldScore} from './unfold.js';
export function position(snapshot, now=performance.now()) {
 if(!snapshot||now-snapshot.receivedAt>8000||!Number.isFinite(snapshot.progress_ms))return null;
 return Math.max(0,(snapshot.progress_ms+(snapshot.is_playing?Math.max(0,now-snapshot.receivedAt):0))/1000);
}
export function scoreTime(seconds,bpm,startSeconds){
 if(!Number.isFinite(seconds)||!Number.isFinite(bpm)||bpm<20||bpm>300||!Number.isFinite(startSeconds)||startSeconds<0)throw Error('Invalid score alignment');
 return (seconds-startSeconds)*bpm/240;
}
export function cursorAt(times,wholeNotes){
 if(!Number.isFinite(wholeNotes)||wholeNotes<0||!times.length)return -1;
 let lo=0,hi=times.length;
 while(lo<hi){const m=(lo+hi)>>1;if(times[m]<=wholeNotes)lo=m+1;else hi=m;}
 return lo-1;
}
export function validateMusicXML(text){
 if(typeof text!=='string'||text.length>5_000_000)throw Error('Choose a MusicXML file under 5 MB');
 if(/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text))throw Error('MusicXML cannot contain entity declarations or an internal DTD');
 text=text.replace(/<!DOCTYPE[^>]*>/gi,'');
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='score-partwise')throw Error('Use an uncompressed partwise MusicXML (.musicxml or .xml) file');
 if(doc.querySelectorAll('note').length>10000)throw Error('Open a shorter vocal score with fewer than 10,000 notes');
 // Repeats and jumps are rewritten into performed order; anything left over is unsupported.
 unfoldScore(doc);
 if(doc.querySelector('sound[time-only], repeat, ending, segno, coda')||[...doc.querySelectorAll('sound')].some(x=>['dacapo','dalsegno','tocoda'].some(a=>x.hasAttribute(a))))throw Error('Export an unfolded score: repeats and jumps need their performed order');
 if(doc.querySelector('opus,script,iframe,image')||[...doc.querySelectorAll('*')].some(x=>[...x.attributes].some(a=>/^on/i.test(a.name)||/javascript:/i.test(a.value))))throw Error('Unsupported active or external score content');
 return doc;
}
export function parseLyrics(doc){
 const words=[];let divisions=1,beat=0;
 const part=doc.querySelector('part');if(!part)return [];
 for(const measure of part.querySelectorAll('measure')){
  for(const el of measure.children){
   if(el.localName==='attributes'&&el.querySelector('divisions'))divisions=Number(el.querySelector('divisions').textContent)||1;
   if(el.localName==='backup')beat-=Number(el.querySelector('duration')?.textContent||0)/divisions;
   if(el.localName==='forward')beat+=Number(el.querySelector('duration')?.textContent||0)/divisions;
   if(el.localName==='note'){
    const duration=Number(el.querySelector('duration')?.textContent||0)/divisions;
    const text=el.querySelector('lyric text')?.textContent;
    if(text&&!el.querySelector('chord'))words.push({at:beat/4,end:(beat+duration)/4,text});
    if(!el.querySelector('chord'))beat+=duration;
   }
  }
 }
 return words;
}

export function validateCues(cues,count){
 if(!Array.isArray(cues)||cues.length!==count||cues.some((x,i)=>!Number.isFinite(x)||x<0||(i>0&&x<=cues[i-1])))throw Error('Timed score cues must give one increasing time in seconds for each score position');
 return cues;
}
export function validateCheckpoints(points,count){
 if(!Array.isArray(points)||points.length>count)throw Error('Invalid saved checkpoints');
 let previous=-1,lastTime=-1;
 for(const point of points){
  if(!point||!Number.isInteger(point.index)||point.index<=previous||point.index>=count||!Number.isFinite(point.seconds)||point.seconds<0||point.seconds<=lastTime)throw Error('Checkpoints must advance through the score and recording');
  previous=point.index;lastTime=point.seconds;
 }
 return points;
}
export function interpolateCues(times,points){
 validateCheckpoints(points,times.length);
 if(times.length<2||times.some((t,i)=>!Number.isFinite(t)||(i&&t<=times[i-1])))throw Error('This score cannot use checkpoint timing: positions must advance in musical time');
 if(points.length<2||points[0].index!==0||points.at(-1).index!==times.length-1)throw Error('Mark the first and last score positions, plus any tempo changes');
 let segment=0;
 return validateCues(times.map((time,index)=>{
  while(segment<points.length-2&&index>points[segment+1].index)segment++;
  const a=points[segment],b=points[segment+1];
  return a.seconds+(b.seconds-a.seconds)*(time-times[a.index])/(times[b.index]-times[a.index]);
 }),times.length);
}
