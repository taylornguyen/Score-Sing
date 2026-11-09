// Words-only score for a song with no notated score, built from the recording's time-synced lyrics (lrclib.js).
// One note per word on a 16th-note grid at 60 BPM, so tempo following lands on the recording's times.
// Word times inside a line are estimated from word length; only line starts come from the recording.
// Notes are unpitched unless pitches learned from the recording (melody.js) are supplied; unknown words get an x notehead.
export const WORDS_BPM=60;
const DIVISIONS=4,MEASURE=16;// 16th notes; one 16th is 0.25 s at 60 BPM, one 4/4 measure is 4 s
const PIECES=[16,12,8,6,4,3,2,1];
const TYPES={16:['whole',false],12:['half',true],8:['half',false],6:['quarter',true],4:['quarter',false],3:['eighth',true],2:['eighth',false],1:['16th',false]};
const SECONDS_PER_WORD=0.6;
const SPELLING=[['C',0],['C',1],['D',0],['E',-1],['E',0],['F',0],['F',1],['G',0],['A',-1],['A',0],['B',-1],['B',0]];
const pitchXml=midi=>{const [step,alter]=SPELLING[((midi%12)+12)%12];return `<pitch><step>${step}</step>${alter?`<alter>${alter}</alter>`:''}<octave>${Math.floor(midi/12)-1}</octave></pitch>`;};
const escape=text=>text.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);

// lines: [{seconds,text}] sorted by time -> [{text,start,end}] in seconds on the score's 16th grid.
export function wordsTiming(lines,durationMs){
 if(!Array.isArray(lines)||lines.length<2)throw Error('Synced lyrics have too few timed lines');
 const songEnd=Number.isFinite(durationMs)?durationMs/1000:null;
 const words=[];
 lines.forEach((line,i)=>{
  const tokens=line.text.split(/\s+/).filter(Boolean);
  if(!tokens.length)return;
  const next=lines[i+1]?.seconds??songEnd??line.seconds+tokens.length*SECONDS_PER_WORD;
  // A line is sung in about SECONDS_PER_WORD per word, and never past the next line.
  const span=Math.max(0.25*tokens.length,Math.min(next-line.seconds,(tokens.length+1)*SECONDS_PER_WORD));
  const weights=tokens.map(t=>t.length+2),total=weights.reduce((a,b)=>a+b,0);
  let at=line.seconds;
  tokens.forEach((text,j)=>{const length=span*weights[j]/total;words.push({text,start:at,end:at+length});at+=length;});
 });
 if(words.length<3)throw Error('Synced lyrics have too few words');
 // Snap to the 16th grid the score is written on, so learned notes and the printed score agree.
 let position=0;
 return words.map(word=>{const start=Math.max(position,Math.round(word.start*4)),end=Math.max(start+1,Math.round(word.end*4));position=end;return {text:word.text,start:start/4,end:end/4};});
}

// pitches: optional MIDI number or null per word. Returns {xml, words} for loadScore with bpm WORDS_BPM and offset 0.
export function wordsScore(lines,{title='Lyrics',durationMs,pitches}={}){
 const words=wordsTiming(lines,durationMs);
 if(pitches!==undefined&&(!Array.isArray(pitches)||pitches.length!==words.length||pitches.some(m=>m!==null&&!(Number.isInteger(m)&&m>=24&&m<=108))))throw Error('Learned notes do not match these lyrics');
 const known=(pitches||[]).filter(m=>m!==null),pitched=known.length>0;
 const middle=pitched?known.slice().sort((a,b)=>a-b)[known.length>>1]:71;
 const events=[];let position=0;
 words.forEach((word,i)=>{
  const start=word.start*4,end=word.end*4;
  if(start>position)events.push({rest:true,length:start-position});
  events.push({text:word.text,length:end-start,midi:pitches?.[i]??null});position=end;
 });
 const measures=[[]];let filled=0;
 const note=(event,length,first,last)=>{
  const [type,dot]=TYPES[length];
  const tie=event.rest?'':(first?'':'<tie type="stop"/>')+(last?'':'<tie type="start"/>');
  const tied=event.rest||(first&&last)?'':`<notations>${first?'':'<tied type="stop"/>'}${last?'':'<tied type="start"/>'}</notations>`;
  const lyric=event.rest||!first?'':`<lyric number="1"><syllabic>single</syllabic><text>${escape(event.text)}</text></lyric>`;
  const sound=event.rest?'<rest/>':!pitched?'<unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched>':pitchXml(event.midi??middle);
  const head=!event.rest&&pitched&&event.midi===null?'<notehead>x</notehead>':'';
  return `<note>${sound}<duration>${length}</duration>${tie}<voice>1</voice><type>${type}</type>${dot?'<dot/>':''}${head}${tied}${lyric}</note>`;
 };
 for(const event of events){
  let left=event.length,first=true;
  while(left>0){
   if(filled===MEASURE){measures.push([]);filled=0;}
   const room=Math.min(left,MEASURE-filled),length=PIECES.find(p=>p<=room);
   left-=length;filled+=length;
   measures.at(-1).push(note(event,length,first,left===0));first=false;
  }
 }
 while(filled<MEASURE){const length=PIECES.find(p=>p<=MEASURE-filled);measures.at(-1).push(note({rest:true},length,true,true));filled+=length;}
 const attributes=`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${!pitched?'<clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details>':middle<52?'<clef><sign>F</sign><line>4</line></clef>':middle<64?'<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>':'<clef><sign>G</sign><line>2</line></clef>'}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${WORDS_BPM}</per-minute></metronome></direction-type><sound tempo="${WORDS_BPM}"/></direction>`;
 const body=measures.map((notes,i)=>`<measure number="${i+1}">${i?'':attributes}${notes.join('')}</measure>`).join('');
 return {words,xml:`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${escape(title)}</work-title></work><part-list><score-part id="P1"><part-name>Words</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`};
}
