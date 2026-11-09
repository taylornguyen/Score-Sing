// Rewrites a partwise score with repeats, voltas and D.C./D.S. jumps into performed order,
// so following and lyric timing can walk it front to back. Unsupported structures throw with a reason.
const MAX_MEASURES=2000;

// measures: [{repeatStart, repeatEnd (play count, 0 = none), ending (numbers[] starting here), endingStop,
//   segno, coda, tocoda, fine, dacapo, dalsegno}] -> [{index, pass}] in performed order.
export function performedOrder(measures){
 const n=measures.length,order=[];
 const segno=measures.findIndex(m=>m.segno),coda=measures.findIndex(m=>m.coda);
 const endingEnd=i=>{for(let j=i;j<n;j++)if(measures[j].endingStop)return j;throw Error('A volta ending never closes');};
 let i=0,start=0,pass=1,jumped=false;
 while(i<n){
  if(order.length>=MAX_MEASURES)throw Error('Unfolded score is too long to follow');
  const m=measures[i];
  if(m.repeatStart&&i!==start){start=i;pass=1;}
  if(m.ending?.length){
   const end=endingEnd(i),another=measures[end+1]?.ending?.length>0;
   // After a D.C./D.S. jump the repeat is not taken again, so only the last ending plays.
   if(jumped?another:!m.ending.includes(pass)){i=end+1;continue;}
  }
  order.push({index:i,pass:jumped?1:pass});
  if(m.fine&&jumped)break;
  if(m.tocoda&&jumped){if(coda<=i)throw Error('To Coda has no coda after it');i=coda;continue;}
  if(m.repeatEnd&&!jumped){
   if(pass<m.repeatEnd){pass++;i=start;continue;}
   start=i+1;pass=1;
  }else if(m.endingStop&&!measures[i+1]?.ending?.length&&!jumped){start=i+1;pass=1;}
  if(m.dacapo&&!jumped){jumped=true;i=0;start=0;pass=1;continue;}
  if(m.dalsegno&&!jumped){if(segno<0)throw Error('D.S. has no segno');jumped=true;i=segno;start=segno;pass=1;continue;}
  i++;
 }
 return order;
}

const kids=(el,name)=>[...el.children].filter(c=>c.localName===name);
const deep=(el,name)=>[...el.getElementsByTagName(name)];
const SOUND_JUMPS=['segno','coda','tocoda','fine','dacapo','dalsegno'];

function structure(measure){
 const info={repeatStart:false,repeatEnd:0,ending:null,endingStop:false};
 for(const barline of kids(measure,'barline')){
  for(const r of kids(barline,'repeat')){
   if(r.getAttribute('direction')==='forward')info.repeatStart=true;
   else{const times=Number(r.getAttribute('times')||2);if(!Number.isInteger(times)||times<1||times>8)throw Error('Unsupported repeat count');info.repeatEnd=times;}
  }
  for(const e of kids(barline,'ending')){
   const type=e.getAttribute('type');
   if(type==='start'){
    const numbers=String(e.getAttribute('number')||'').split(/[\s,]+/).filter(Boolean).map(Number);
    if(!numbers.length||numbers.some(x=>!Number.isInteger(x)||x<1))throw Error('A volta ending has no pass number');
    info.ending=numbers;
   }else if(type==='stop'||type==='discontinue')info.endingStop=true;
  }
 }
 for(const sound of deep(measure,'sound')){
  if(sound.hasAttribute('time-only'))throw Error('Pass-specific notes (time-only) are not supported');
  for(const a of SOUND_JUMPS)if(sound.hasAttribute(a)&&sound.getAttribute(a)!=='no')info[a]=true;
 }
 // A drawn segno sign marks the D.S. target even without playback attributes; a drawn coda alone is ambiguous.
 if(deep(measure,'segno').length)info.segno=true;
 if(deep(measure,'coda').length&&!info.coda&&!info.tocoda)throw Error('A coda sign has no playback instruction');
 return info;
}
const merge=(a,b)=>({repeatStart:a.repeatStart||b.repeatStart,repeatEnd:Math.max(a.repeatEnd,b.repeatEnd),ending:a.ending||b.ending,endingStop:a.endingStop||b.endingStop,
 ...Object.fromEntries(SOUND_JUMPS.map(k=>[k,!!(a[k]||b[k])]))});

// Attribute state in force at the start of each measure, for measures reached by a jump.
const ATTRIBUTE_ORDER=['divisions','key','time','staves','part-symbol','instruments','clef','staff-details','transpose'];
function attributeStates(measures){
 const states=[];let state=new Map();
 for(const measure of measures){
  states.push(state);state=new Map(state);
  for(const attributes of kids(measure,'attributes'))for(const child of attributes.children){
   const key=child.localName+(child.getAttribute('number')?'#'+child.getAttribute('number'):'');
   state.set(key,child);
  }
 }
 return states;
}
function attributesElement(doc,state){
 const el=doc.createElementNS(doc.documentElement.namespaceURI,'attributes');
 const sorted=[...state.entries()].sort((a,b)=>ATTRIBUTE_ORDER.indexOf(a[0].split('#')[0])-ATTRIBUTE_ORDER.indexOf(b[0].split('#')[0]));
 for(const [,child] of sorted)el.append(child.cloneNode(true));
 return el;
}

function clean(measure,pass){
 for(const barline of kids(measure,'barline'))for(const r of [...kids(barline,'repeat'),...kids(barline,'ending')])r.remove();
 for(const sound of deep(measure,'sound')){
  for(const a of SOUND_JUMPS)sound.removeAttribute(a);
  if(!sound.attributes.length&&!sound.children.length)sound.remove();
 }
 for(const sign of [...deep(measure,'segno'),...deep(measure,'coda')]){
  const parent=sign.parentElement;sign.remove();
  if(parent?.localName!=='direction-type'||parent.children.length)continue;
  const direction=parent.parentElement;parent.remove();
  if(direction&&!kids(direction,'direction-type').length)direction.remove();
 }
 for(const barline of kids(measure,'barline'))if(!barline.children.length)barline.remove();
 // Each pass sings its own verse when the score has one; otherwise the first.
 for(const note of kids(measure,'note')){
  const lyrics=kids(note,'lyric');
  if(lyrics.length<2)continue;
  const number=l=>Number(l.getAttribute('number'))||1;
  const keep=lyrics.find(l=>number(l)===pass)||lyrics.reduce((a,b)=>number(b)<number(a)?b:a);
  for(const l of lyrics)if(l!==keep)l.remove();
  keep.setAttribute('number','1');
 }
}

// Mutates doc in place. Returns the number of measures added by unfolding (0 when there is nothing to unfold).
export function unfoldScore(doc){
 const parts=kids(doc.documentElement,'part');
 const measures=parts.map(p=>kids(p,'measure'));
 if(!measures.length||measures.some(m=>m.length!==measures[0].length))throw Error('Parts have different measure counts');
 const infos=measures[0].map((_,i)=>measures.map(m=>structure(m[i])).reduce(merge));
 if(!infos.some(m=>m.repeatStart||m.repeatEnd||m.ending||SOUND_JUMPS.some(k=>m[k])))return 0;
 const order=performedOrder(infos);
 parts.forEach((part,p)=>{
  const original=measures[p],states=attributeStates(original);
  const unfolded=order.map(({index,pass},k)=>{
   const copy=original[index].cloneNode(true);
   clean(copy,pass);
   copy.setAttribute('number',String(k+1));if(k>0)copy.removeAttribute('implicit');
   if(k>0&&order[k-1].index!==index-1&&states[index].size)copy.insertBefore(attributesElement(doc,states[index]),[...copy.children].find(c=>c.localName!=='print')||null);
   return copy;
  });
  for(const m of original)m.remove();
  part.append(...unfolded);
 });
 return order.length-measures[0].length;
}
