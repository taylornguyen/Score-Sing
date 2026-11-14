import {position,cursorAt,validateMusicXML,validateCues,validateCheckpoints,interpolateCues} from './sync.js';
import * as spotify from './spotify.js';
import {readScoreFile} from './score-file.js';
import {createReporter} from './observation.js';
import {createLibrary,renderSwitcher,deviceOnly} from './library.js';
import {createStage} from './stage.js';
import {createPitchMeter,compare} from './pitch.js';
import {catalogCandidates,downloadScore,xmlLyrics} from './auto-score.js';
import {wordsScore,wordsTiming,WORDS_BPM} from './words-score.js';
import {framePitch,wordAt,createMelody,openRecordingAudio} from './melody.js';
import {syncedLyrics} from './lrclib.js';
import {autoAlign,lyricsMatch,MIN_CONFIDENCE} from './lyrics-align.js';
// Score elements live in the floating window's document while it is open.
let floatingDoc=null;
const $=s=>document.querySelector(s)||floatingDoc?.querySelector(s)||null;
let auth,renderer,entries=[],entryTimes=[],cursorIndex=-1,snapshot=null,score=null,subject='',pollTimer,renderGeneration=0,resizeTimer;
let connectBusy=false,following=false,loading=false,authGeneration=0,inspecting=false,playbackError='';
let library,libraryError='',lastTrack=null,trackLookup=null,switchSequence=0;
const observation=createReporter(async(payload,signal)=>{
 const principal=subject;if(!principal||!auth)throw Error('Sign in before verification');
 const token=await auth.getValidToken();
 if(signal.aborted||subject!==principal||payload.runId!==observation.runId())throw Error('Verification account changed');
 const response=await fetch('/api/verification',{method:'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!response.ok)throw Error('Verification report was not accepted');
});
const error=msg=>{$('#error').textContent=msg||'';$('#error').hidden=!msg;};
const state=msg=>{$('#sync-state').textContent=msg;};
function rerender(){if(renderer){renderer.render();cursorIndex=-1;updateFollow();}}
let pitchTargets=[];
const NOTE_NAMES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'],noteName=midi=>NOTE_NAMES[((midi%12)+12)%12]+(Math.floor(midi/12)-1);
const pitchLabel={'in-tune':'In tune',sharp:'Sharp',flat:'Flat'};
function showPitch(reading){
 const el=$('#pitch-reading');if(!el)return;
 const result=reading&&compare(reading.hz,pitchTargets);
 el.dataset.state=result?.state||'';
 el.textContent=!pitchTargets.length?'Mic on':!reading?'Listening…':`${pitchLabel[result.state]} ${result.cents>0?'+':result.cents<0?'−':''}${Math.abs(result.cents)}¢`;
}
const pitch=createPitchMeter({onReading:showPitch,onStop:reason=>{$('#mic').checked=false;$('#pitch-reading').hidden=true;if(reason)error(reason);}});
const stage=createStage({content:$('.score-layout'),button:$('#float'),onResize:rerender,onMove:doc=>{floatingDoc=doc;},onTick:()=>{if(!subject)return;if(document.hidden&&Date.now()>pollDueAt)poll();updateFollow();},onError:error});
function showLibrary(){renderSwitcher($('.score-toolbar .tools'),library?.scores||[],score,id=>openSaved(id).catch(e=>error(e.message)));}
function save(){
 // Words-only scores are rebuilt from the lyrics service each time, so a real score found later takes their place.
 if(!score||score.preview||score.wordsOnly||!subject||!library)return;
 const principal=subject;
 library.save(score).then(()=>{if(subject!==principal)return;if(libraryError&&$('#error').textContent===libraryError)error('');libraryError='';showLibrary();},
  e=>{if(subject!==principal)return;libraryError=(e.status===503||!e.status)&&library.keepOnDevice(score)?deviceOnly:e.message;error(libraryError);});
}
async function openSaved(id,generation=++renderGeneration){
 if(score?.libraryId===id)return showLibrary();
 const next=await library.open(id);
 if(generation!==renderGeneration)return false;
 return loadScore(next,generation);
}
// Spotify started another song: load its newest bound score, else find one in the catalog,
// unless the current score is still being prepared (unbound).
async function switchForTrack(track){
 const trackId=track.id,sequence=++switchSequence,principal=subject;trackLookup={trackId,state:'checking'};
 const current=()=>sequence===switchSequence&&subject===principal;
 try{
  let listed=true;try{await library.list();}catch{listed=false;}
  if(!current())return;
  if(score&&!score.preview&&score.trackId===trackId){trackLookup.state='current';return;}
  const match=listed?library.boundTo(trackId):null;
  if(loading||(score&&!score.preview&&!score.trackId)){trackLookup.state=match?'kept':'none';return;}
  if(match){const generation=++renderGeneration;if(await openSaved(match.id,generation)!==false&&current())trackLookup.state='current';return;}
  await autoScore(track,0,current,true);
 }catch(e){if(current()){trackLookup.state='error';trackLookup.error=e.message;}}
 finally{showLibrary();updateFollow();}
}
// Loads a catalog score for this song and times it from the recording's synced lyrics.
// The first search picks the best-ranked score whose words match the recording; "Try another" takes the next rank as is.
async function autoScore(track,rank,current,screen=false){
 trackLookup.state='searching';updateFollow();
 const fetcher=(url,options)=>auth.fetchWithAuth(url,options);
 const lyricsLookup=syncedLyrics({title:track.name,artist:track.artists?.[0]?.name,album:track.album?.name,durationMs:track.duration_ms})
  .catch(e=>({state:'failed',error:e.message}));
 let searchError=null;
 const candidates=await catalogCandidates(fetcher,track).catch(e=>{searchError=e;return [];});
 const lyrics=await lyricsLookup;
 if(!current())return;
 if(!candidates.length){
  if(lyrics.state==='found'&&screen)return wordsOnly(track,lyrics,searchError,current);
  if(searchError)throw searchError;
  trackLookup.state='missing';return;
 }
 let pick=rank%candidates.length,xml=null;
 if(screen){
  // Skip scores this app cannot play (unreadable, or with unsupported jumps); with lyrics, take the first whose words match.
  let fallback=null;
  for(const [i,candidate] of candidates.entries()){
   const text=await downloadScore(fetcher,candidate).then(t=>new XMLSerializer().serializeToString(validateMusicXML(t))).catch(()=>null);
   if(!current())return;
   if(text===null)continue;
   fallback??={i,text};
   if(lyrics.state!=='found'||lyricsMatch(xmlLyrics(text),lyrics.lines)>=MIN_CONFIDENCE){pick=i;xml=text;break;}
  }
  if(xml===null&&fallback){pick=fallback.i;xml=fallback.text;}
 }
 const candidate=candidates[pick];
 xml??=await downloadScore(fetcher,candidate);
 if(!current())return;
 // "Try another" replaces an untouched automatic score instead of piling up saved copies.
 // Only a copy the library stored (it has a revision) can be removed; device-only copies are simply replaced.
 const replaced=score?.catalog&&score.revision&&score.trackId===track.id&&!score.checkpointsDirty?score.libraryId:null;
 const catalog={id:candidate.id,rank:pick,count:candidates.length,credit:[candidate.artist,candidate.arranger].filter(Boolean).join(' · '),timing:'checking'};
 const generation=++renderGeneration;
 if(await loadScore({xml,title:candidate.title,trackId:track.id,catalog},generation)===false||!current())return;
 trackLookup.state='current';const loaded=score;showAutoScore();
 if(replaced&&replaced!==score.libraryId)library.remove(replaced).then(showLibrary,e=>error('The previous automatic score is still saved: '+e.message));
 try{
  if(lyrics.state==='failed')throw Error(lyrics.error);
  if(lyrics.state!=='found')throw Error(lyrics.state==='instrumental'?'Instrumental recording':'No synced lyrics for this recording');
  const aligned=autoAlign(entries,lyrics.lines);
  if(score!==loaded)return;
  score.checkpoints=aligned.checkpoints;score.cues=interpolateCues(entryTimes,aligned.checkpoints);score.checkpointsDirty=false;catalog.timing='lyrics';
 }catch(e){if(score!==loaded)return;catalog.timing='tempo';catalog.timingNote=e.message.slice(0,300);}
 save();alignmentControls();resetCursor();updateFollow();showAutoScore();
}
// No notated score: show the recording's words on a timed line so the singer can still follow along.
async function wordsOnly(track,lyrics,searchError,current){
 const generation=++renderGeneration;
 const info={source:lyrics.source,note:searchError?`Score search failed: ${searchError.message}`:'No score found for this song',lines:lyrics.lines,durationMs:track.duration_ms};
 if(await loadWords({title:track.name,trackId:track.id,info},generation)===false||!current())return;
 trackLookup.state='current';resetCursor();updateFollow();
}
// Notes learned from earlier listens (see "Learn notes") are written into the words-only score.
const melodyKey=(principal,trackId)=>`score-sing-melody:${principal}:${trackId}`;
function savedMelody(trackId){
 const text=localStorage.getItem(melodyKey(subject,trackId));if(!text)return null;
 try{return JSON.parse(text);}catch{throw Error('Learned notes for this song are unreadable');}
}
function loadWords({title,trackId,info},generation){
 const pitches=createMelody(wordsTiming(info.lines,info.durationMs),savedMelody(trackId)).pitches();
 const learned=pitches.filter(m=>m!==null).length;
 const {xml,words}=wordsScore(info.lines,{title,durationMs:info.durationMs,pitches:learned?pitches:undefined});
 return loadScore({xml,title,trackId,bpm:WORDS_BPM,offset:0,wordsOnly:{...info,words,pitches,learned}},generation);
}
// Learning listens to the recording (shared system audio, or the microphone) while a words-only score is followed.
// Each frame's strongest vocal-range pitch is credited to the word being sung then; votes are kept on this device.
const FFT=8192;let learning=null,learnStarting=false;
function learnButton(){
 const button=$('#learn-notes');if(!button)return;
 button.hidden=!(score?.wordsOnly||learning);button.setAttribute('aria-pressed',String(!!learning));button.disabled=learnStarting;
 button.textContent=!learning?'Learn notes':learning.melody?`Stop learning · ${learning.learned}/${learning.words.length} notes`:'Stop learning';
}
function flushMelody(l){
 if(!l.melody||!l.dirty)return;l.dirty=false;
 try{localStorage.setItem(melodyKey(l.subject,l.trackId),JSON.stringify(l.melody));}catch(e){error(`Learned notes could not be kept: ${e.message}`);}
}
function bindMelody(l){
 const words=score?.wordsOnly?.words||null;
 if(l.words===words)return;
 flushMelody(l);
 if(l.melody)observation.learn({notes:l.melody.learned()-l.startLearned});
 l.words=words;l.trackId=score?.trackId;l.melody=null;l.learned=0;
 if(words)try{l.melody=createMelody(words,savedMelody(l.trackId));l.learned=l.startLearned=l.melody.learned();}catch(e){error(e.message);}
 learnButton();showAutoScore();
}
function listen(){
 const l=learning;if(!l||loading)return;
 bindMelody(l);
 if(!l.melody||!snapshot?.is_playing||snapshot.item?.id!==l.trackId)return;
 const p=position(snapshot);if(p===null)return;
 l.analyser.getFloatFrequencyData(l.db);
 // The analyser window is centered about half its length behind the newest sample.
 const index=wordAt(l.words,p-FFT/2/l.context.sampleRate);if(index<0)return;
 const frame=framePitch(l.db,l.context.sampleRate,FFT);
 l.melody.add(index,frame);l.dirty=true;if(frame)l.frames++;
 if(Date.now()-l.shown>1000){l.shown=Date.now();l.learned=l.melody.learned();learnButton();}
 if(Date.now()-l.flushed>5000){l.flushed=Date.now();flushMelody(l);observation.learn({frames:l.frames});l.frames=0;}
}
async function stopLearning(reason='',show=true){
 const l=learning;if(!l)return;learning=null;
 clearInterval(l.timer);l.stream.getTracks().forEach(t=>t.stop());l.context.close().catch(()=>{});
 flushMelody(l);observation.learn({frames:l.frames,notes:l.melody?l.melody.learned()-l.startLearned:0});learnButton();showAutoScore();
 if(reason)error(reason);
 // Show what was learned on the score that is open now.
 if(show&&l.melody&&score?.wordsOnly?.words===l.words&&!loading&&subject===l.subject&&l.melody.learned()!==score.wordsOnly.learned){
  const generation=++renderGeneration;
  if(await loadWords({title:score.title,trackId:score.trackId,info:score.wordsOnly},generation)!==false){resetCursor();updateFollow();}
 }
}
async function startLearning(){
 if(learning||learnStarting)return;
 if(!score?.wordsOnly)throw Error('Notes are learned for words-only scores');
 const principal=subject;learnStarting=true;learnButton();
 let timeout,late=false;
 try{
  // The share picker waits on the person; abandon it after two minutes and release a share that arrives later.
  const opened=openRecordingAudio();
  opened.then(({stream})=>{if(late)stream.getTracks().forEach(t=>t.stop());},()=>{});
  const {stream,source}=await Promise.race([opened,new Promise((_,reject)=>{timeout=setTimeout(()=>{late=true;reject(Error('Listening did not start within two minutes'));},120000);})]);
  if(subject!==principal){stream.getTracks().forEach(t=>t.stop());return;}
  const context=new AudioContext();await context.resume();
  const analyser=context.createAnalyser();analyser.fftSize=FFT;analyser.smoothingTimeConstant=0;
  context.createMediaStreamSource(stream).connect(analyser);
  learning={stream,source,context,analyser,db:new Float32Array(analyser.frequencyBinCount),subject:principal,words:undefined,melody:null,learned:0,startLearned:0,frames:0,dirty:false,shown:0,flushed:Date.now()};
  for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>stopLearning('Listening stopped: the audio source ended'));
  learning.timer=setInterval(listen,50);bindMelody(learning);error('');
 }catch(e){
  throw e.name==='NotAllowedError'?Error('Listening was not allowed'):e;
 }finally{clearTimeout(timeout);learnStarting=false;learnButton();showAutoScore();}
}
function showAutoScore(){
 const auto=score?.catalog;$('#next-match').hidden=!(auto?.count>1);learnButton();
 const words=score?.wordsOnly;
 if(words){
  $('#score-subtitle').textContent=learning?.words===words.words?`Words only · learning notes from the ${learning.source}${learning.source==='microphone'?': play the song aloud':''}`
   :words.learned?`Words · ${words.learned}/${words.words.length} notes estimated from the recording · timed from lyrics`:`Words only · ${words.note} · timed from lyrics`;
  return;
 }
 if(!auto)return;
 $('#next-match').textContent=`Try another (${auto.rank+1}/${auto.count})`;
 $('#score-subtitle').textContent=[auto.credit,auto.timing==='lyrics'?'Found automatically · timed from lyrics':auto.timing==='tempo'?`Found automatically · ${auto.timingNote}: timing is a tempo estimate`:'Found automatically · timing…'].filter(Boolean).join(' · ');
}
function lookupState(){
 const s=trackLookup?.trackId===snapshot?.item?.id?trackLookup.state:'',kept=score&&!score.preview;
 return s==='checking'||s==='searching'?'Finding this song’s score…':s==='missing'||s==='none'?(kept?'No score found for this song · keeping this score':'No score found for this song'):s==='error'?`Automatic score failed: ${trackLookup.error}${kept?' · keeping this score':''}`:s==='kept'?'Saved score available for this song':'';
}
function resetCursor(){pitchTargets=[];if(renderer?.cursor)renderer.cursor.hide();cursorIndex=-1;$('#current-note').textContent='—';$('#current-syllable').textContent='Waiting for music';$('#note-position').textContent=score?.trackId?'Waiting for matching song':'Open your song’s MusicXML score';}
function timing(){
 const bpm=Number($('#bpm').value),offset=Number($('#offset').value);
 if(!Number.isFinite(bpm)||bpm<20||bpm>300||!Number.isFinite(offset)||offset<0)throw Error('Use a tempo from 20 to 300 and a nonnegative start time');
 return {bpm,offset};
}
function alignmentControls(){
 const timed=!!score?.cues;
 for(const id of ['#bpm','#offset','#anchor'])$(id).disabled=timed;
 $('#alignment-export').disabled=!timed;
 const index=Number($('#checkpoint-position').value),point=score?.checkpoints?.find(x=>x.index===index);
 $('#checkpoint-status').textContent=`${score?.checkpoints?.length||0} marks${score?.checkpointsDirty?' · unapplied':''}${point?' · '+point.seconds.toFixed(2)+' s':''}`;
 $('#checkpoint-remove').disabled=!point;
}
function displayPosition(index){
 if(!renderer||!entries[index])return;
 const c=renderer.cursor;
 if(index<cursorIndex||cursorIndex<0){c.reset();cursorIndex=0;}
 while(cursorIndex<index&&!c.Iterator.EndReached){c.next();cursorIndex++;}
 c.show();const entry=entries[index];pitchTargets=entry.midis||[];$('#current-note').textContent=entry.pitches;$('#current-syllable').textContent=entry.syllable||'♪';$('#note-position').textContent=`Position ${index+1} / ${entries.length}`;
}
async function loadScore(next,generation=++renderGeneration){
 const doc=validateMusicXML(next.xml);
 next={...next,xml:new XMLSerializer().serializeToString(doc)};
 if(generation!==renderGeneration||!subject)return false;
 error('');state('Rendering score…');loading=true;
 let host,fresh,deadline;
 $('#score-file').disabled=true;
 try{
  host=document.createElement('div');host.className='score-stage';$('#score').append(host);
  fresh=new opensheetmusicdisplay.OpenSheetMusicDisplay(host,{autoResize:false,backend:'svg',drawTitle:false,drawSubtitle:false,drawComposer:false,drawCredits:false,drawPartNames:false,drawMeasureNumbers:true,followCursor:false,cursorsOptions:[{type:0,color:'#c55780',alpha:0.42,follow:false}]});
  await Promise.race([fresh.load(next.xml),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Score rendering timed out')),15000);})]);
  if(generation!==renderGeneration||!subject)return false;
  fresh.Zoom=innerWidth<700?0.85:1;fresh.render();
  const c=fresh.cursor;c.reset();const list=[];
  while(!c.Iterator.EndReached){
   const at=c.Iterator.CurrentSourceTimestamp.RealValue;
   const notes=c.NotesUnderCursor();
   const pitches=notes.filter(n=>n.Pitch).map(n=>{
    const f=n.Pitch.Frequency;if(!f||f<=0)return n.Pitch.ToString();
    return noteName(Math.round(69+12*Math.log2(f/440)));
   });
   const syllables=notes.flatMap(n=>n.ParentVoiceEntry?.LyricsEntries?n.ParentVoiceEntry.LyricsEntries.values().map(x=>x.Text||''):[]).filter(Boolean);
   const midis=notes.filter(n=>n.Pitch?.Frequency>0).map(n=>Math.round(69+12*Math.log2(n.Pitch.Frequency/440)));
   // Each staff's first verse, for lining the score up with the recording's lyrics (one staff is chosen below).
   const verses=new Map();
   for(const n of notes){
    const staff=n.ParentStaffEntry?.ParentStaff?.idInMusicSheet??0;
    for(const x of n.ParentVoiceEntry?.LyricsEntries?.values()||[])if(x.Text&&!(verses.get(staff)?.VerseNumber<=Number(x.VerseNumber)))verses.set(staff,{...x,VerseNumber:Number(x.VerseNumber),Text:x.Text,SyllableIndex:x.SyllableIndex});
   }
   list.push({at,pitches:next.wordsOnly?(notes.some(n=>!n.isRest())?'Sung':'Rest'):[...new Set(pitches)].join(' / ')||'Rest',midis:next.wordsOnly?[]:[...new Set(midis)],syllable:[...new Set(syllables)].join(' '),verses});
   if(list.length>4000)throw Error('This score is too large. Open a shorter vocal part.');
   c.next();
  }
  if(!list.length)throw Error('The score contains no playable notes');
  // The sung line is the first staff with lyrics, so backing parts' words do not mix into it.
  const lyricStaff=Math.min(...list.flatMap(e=>[...e.verses.keys()]));
  for(const entry of list){const verse=entry.verses.get(lyricStaff);delete entry.verses;entry.lyric=verse?.Text;entry.wordStart=!(verse?.SyllableIndex>0);}
  // Words-only notes carry the learned note of their word; tied continuations belong to the word before them.
  if(next.wordsOnly){
   let word=-1;
   for(const entry of list){
    if(entry.pitches==='Rest')continue;
    if(entry.lyric)word++;
    const midi=next.wordsOnly.pitches?.[word]??null;
    entry.midis=midi===null?[]:[midi];entry.pitches=midi===null?'Sung':noteName(midi);
   }
   if(word+1!==next.wordsOnly.words.length)throw Error('The words-only score does not match its lyrics');
  }
  if(next.cues!==undefined)validateCues(next.cues,list.length);
  if(next.trackId!=null&&!/^[A-Za-z0-9]{22}$/.test(next.trackId))throw Error('A timed score needs the exact Spotify track ID');
  if(next.cues&&!next.trackId)throw Error('A timed score needs the exact Spotify track ID');
  if(next.checkpoints!==undefined)validateCheckpoints(next.checkpoints,list.length);
  if((next.bpm!==undefined&&(!Number.isFinite(next.bpm)||next.bpm<20||next.bpm>300))||(next.offset!==undefined&&(!Number.isFinite(next.offset)||next.offset<0)))throw Error('Invalid saved score alignment');
  const bpm=next.bpm??(Number(doc.querySelector('sound[tempo]')?.getAttribute('tempo'))||120),offset=next.offset??0;
  if(!Number.isFinite(bpm)||bpm<20||bpm>300||!Number.isFinite(offset)||offset<0)throw Error('Invalid saved score alignment');
  c.reset();c.hide();renderer?.clear();host.className='';$('#score').replaceChildren(host);
  renderer=fresh;entries=list;entryTimes=list.map(x=>x.at);cursorIndex=-1;inspecting=false;score={...next,bpm,offset};
  $('#score-title').textContent=next.title||doc.querySelector('work-title,movement-title')?.textContent||'Untitled score';
  $('#score-subtitle').textContent=next.preview?'Beethoven · public-domain melody preview':doc.querySelector('creator[type="composer"]')?.textContent||'Imported score';
  showAutoScore();
  $('#bpm').value=score.bpm;$('#offset').value=score.offset;
  const picker=$('#checkpoint-position');picker.replaceChildren(...list.map((entry,index)=>{
   const option=document.createElement('option');option.value=index;option.textContent=`${index+1} · ${entry.pitches}${entry.syllable?' · '+entry.syllable:''}`;return option;
  }));
  alignmentControls();
  if(!score.revision||score.fromDevice)save();showLibrary();return true;
 }finally{
  clearTimeout(deadline);
  if(renderer!==fresh){fresh?.clear();host?.remove();}
  if(generation===renderGeneration){$('#score-file').disabled=false;loading=false;updateFollow();}
 }
}

function updateFollow(){
 if(loading)return;
 const p=position(snapshot);$('#clock').textContent=p===null?'—':`${Math.floor(p/60)}:${String(Math.floor(p%60)).padStart(2,'0')}`;
 if(inspecting){displayPosition(Number($('#checkpoint-position').value));state('Marking recording checkpoints');return;}
 const matching=score&&!score.preview&&snapshot?.item?.id===score.trackId;
 following=!!matching&&p!==null;
 stage.awake(following&&!!snapshot.is_playing);
 $('#state-dot').classList.toggle('live',following&&snapshot.is_playing);
 if(!following){
  observation.follow({following:false});resetCursor();
  state(!spotify.isConnected()?(score?.preview?'Score preview · no audio':'Connect Spotify to follow this score'):!snapshot?'Waiting for a Spotify song':p===null?'Playback data is stale · following stopped':lookupState()||(!score?.trackId?'Open and align a score for this song':'Score does not match this song'));
  return;
 }
 let index;
 try{index=score.cues?cursorAt(score.cues,p):cursorAt(entryTimes,(p-score.offset)*score.bpm/240);}catch(e){error(e.message);return;}
 state((snapshot.is_playing?'Following':'Paused')+(score.cues?' · timed score':' · tempo-based'));
 if(index<0){observation.follow({following:false});resetCursor();state('Waiting for the first note');return;}
 observation.follow({following:true,index,playing:snapshot.is_playing});
 if(index===cursorIndex)return;
 displayPosition(index);const c=renderer.cursor;
 if($('#autoscroll').checked){const el=c.cursorElement,view=el.ownerDocument.defaultView,margin=stage.floating()?20:80;const rect=el.getBoundingClientRect();if(rect.top<margin||rect.bottom>view.innerHeight-(stage.floating()?20:120))el.scrollIntoView({block:'center',behavior:'smooth'});}
}
// A minimized main window throttles its own timers; while floating, the visible floating window restarts overdue polls.
let pollGeneration=0,pollDueAt=Infinity;
async function poll(){
 clearTimeout(pollTimer);const gen=++pollGeneration;pollDueAt=Infinity;
 if(!spotify.isConnected()||(document.hidden&&!stage.floating()))return;
 let delay=2500;
 try{
  const next=await spotify.playback();if(gen!==pollGeneration)return;snapshot=next;observation.playback(next);
  if(next&&next.item.id!==lastTrack){lastTrack=next.item.id;switchForTrack(next.item);}
  if(next){$('#track-title').textContent=next.item.name;$('#track-artist').textContent=next.item.artists.map(a=>a.name).join(', ');}
  else{$('#track-title').textContent='No active Spotify song';$('#track-artist').textContent='Play a song in Spotify on Windows or iPhone.';}
  if(playbackError&&$('#error').textContent===playbackError)error('');playbackError='';
 }catch(e){
  if(gen!==pollGeneration)return;snapshot=null;
  playbackError=e.status===401?'Spotify access expired. Disconnect and connect again.':e.status===403?'Spotify denied access. Check the developer app’s allowlist and account access.':e.status===429?'Spotify is rate limiting requests. Following will resume after the retry interval.':e.message;error(playbackError);
  delay=e.status===429?Math.min(Math.max(5,e.retryAfter),3600)*1000:10000;
 }
 updateConnection();updateFollow();pollTimer=setTimeout(poll,delay);pollDueAt=Date.now()+delay+1000;
}
function updateConnection(){$('#connect').hidden=spotify.isConnected();$('#disconnect').hidden=!spotify.isConnected();}
function disconnectSpotify(){
 observation.reset();
 spotify.disconnect();++pollGeneration;clearTimeout(pollTimer);snapshot=null;playbackError='';inspecting=false;lastTrack=null;trackLookup=null;++switchSequence;
 updateConnection();$('#state-dot').classList.remove('live');$('#clock').textContent='—';
 $('#track-title').textContent='Connect your music';$('#track-artist').textContent='Keep Spotify playing. Follow the score here.';
}

function bindScore(){
 if(loading)throw Error('Wait for the score to finish loading');
 if(!score||score.preview)throw Error('Open your song’s MusicXML score first');
 if(!snapshot?.item?.id||position(snapshot)===null)throw Error('Play the matching song in Spotify first');
 const values=timing();
 if(score.trackId!==snapshot.item.id){delete score.cues;score.checkpoints=[];score.checkpointsDirty=false;}
 score.trackId=snapshot.item.id;Object.assign(score,values);inspecting=false;alignmentControls();save();resetCursor();updateFollow();
}
function handler(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>error(e.message)));}
$('#connect').addEventListener('click',async()=>{
 if(connectBusy)return;connectBusy=true;$('#connect').disabled=true;error('');
 try{if(await spotify.connect()){connectBusy=false;$('#connect').disabled=false;clearTimeout(pollTimer);poll();}}
 catch(e){error(e.message);connectBusy=false;$('#connect').disabled=false;}
});
addEventListener('pageshow',()=>{connectBusy=false;$('#connect').disabled=false;});
handler('#disconnect',()=>{disconnectSpotify();resetCursor();updateFollow();error('');});
handler('#align-toggle',()=>{const el=$('#alignment');el.hidden=!el.hidden;$('#align-toggle').setAttribute('aria-expanded',String(!el.hidden));if(el.hidden){inspecting=false;cursorIndex=-1;updateFollow();}});
handler('#bind',bindScore);
handler('#learn-notes',()=>learning?stopLearning():startLearning());
handler('#next-match',async()=>{
 const auto=score?.catalog,track=snapshot?.item;
 if(!auto||loading||!track||track.id!==score.trackId)throw Error('Play the matching song in Spotify first');
 const sequence=++switchSequence,principal=subject;trackLookup={trackId:track.id,state:'searching'};
 try{await autoScore(track,auto.rank+1,()=>sequence===switchSequence&&subject===principal);}
 catch(e){if(sequence===switchSequence){trackLookup.state='error';trackLookup.error=e.message;}throw e;}
 finally{showLibrary();updateFollow();}
});
handler('#anchor',()=>{const p=position(snapshot);if(p===null)throw Error('Play the matching song in Spotify first');$('#offset').value=p.toFixed(2);bindScore();});
for(const id of ['#bpm','#offset'])$(id).addEventListener('change',()=>{try{const t=timing();if(loading)throw Error('Wait for the score to finish loading');if(score){Object.assign(score,t);save();resetCursor();updateFollow();}error('');}catch(e){error(e.message);}});
$('#checkpoint-position').addEventListener('change',()=>{if(!loading){inspecting=true;displayPosition(Number($('#checkpoint-position').value));alignmentControls();}});
handler('#checkpoint-capture',()=>{
 if(loading||!score||score.preview)throw Error('Open your song’s score first');
 if(!score.trackId||snapshot?.item?.id!==score.trackId)throw Error('Use score for the matching song first');
 const seconds=position(snapshot);if(seconds===null)throw Error('Fresh Spotify playback timing is required');
 const index=Number($('#checkpoint-position').value);
 const points=[...(score.checkpoints||[]).filter(p=>p.index!==index),{index,seconds}].sort((a,b)=>a.index-b.index);
 validateCheckpoints(points,entries.length);score.checkpoints=points;score.checkpointsDirty=true;inspecting=true;displayPosition(index);save();alignmentControls();error('');
});
handler('#checkpoint-remove',()=>{if(!score||loading)return;score.checkpoints=(score.checkpoints||[]).filter(p=>p.index!==Number($('#checkpoint-position').value));score.checkpointsDirty=true;save();alignmentControls();});
handler('#checkpoint-apply',()=>{
 if(loading||!score?.trackId)throw Error('Use score for the matching song first');
 const cues=interpolateCues(entryTimes,score.checkpoints||[]);
 score.cues=cues;score.checkpointsDirty=false;inspecting=false;save();alignmentControls();resetCursor();updateFollow();error('');
});
handler('#alignment-export',()=>{
 if(!score?.cues||loading)throw Error('Apply recording checkpoints before exporting');
 const blob=new Blob([JSON.stringify({schemaVersion:1,title:score.title,spotifyTrackId:score.trackId,musicxml:score.xml,cues:score.cues,checkpoints:score.checkpointsDirty?[]:(score.checkpoints||[])},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='score-sing-timed-score.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('#score-file').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file||!subject)return;
 const generation=++renderGeneration;$('#score-file').disabled=true;loading=true;
 try{
  if(file.size>5_000_000)throw Error('Choose a score under 5 MB');
  const text=await readScoreFile(file);if(generation!==renderGeneration||!subject)return;let next;
  if(file.name.toLowerCase().endsWith('.json')){
   const p=JSON.parse(text);if(!p||p.schemaVersion!==1||typeof p.musicxml!=='string')throw Error('Use a version 1 timed-score package');
   next={xml:p.musicxml,cues:p.cues,trackId:p.spotifyTrackId,title:p.title,checkpoints:p.checkpoints};
   if(!p.cues)throw Error('Timed score package is missing cues');
  }else next={xml:text,title:file.name.replace(/\.(musicxml|xml|mxl)$/i,''),trackId:null};
  await loadScore(next,generation);
 }catch(e){if(generation===renderGeneration)error(e.message);}
 finally{if(generation===renderGeneration){$('#score-file').disabled=false;loading=false;updateFollow();}e.target.value='';}
});
async function signedIn(){
 const epoch=++authGeneration,initialRender=renderGeneration;
 try{
  const response=await auth.fetchWithAuth('/api/session',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Your Score Sing sign-in could not be verified');
  const user=await response.json();if(epoch!==authGeneration)return;
  if(typeof user.subject!=='string'||!user.subject)throw Error('Your sign-in is missing its account identity');
  if(subject===user.subject){poll();return;}
  const changed=!!subject&&subject!==user.subject;subject=user.subject;library.reset(subject);libraryError='';
  if(changed){disconnectSpotify();++renderGeneration;score=null;entries=[];entryTimes=[];renderer?.clear();renderer=null;$('#score').replaceChildren();}
  // A newer user import owns the surface, even if verification finished later.
  if(!changed&&initialRender!==renderGeneration){poll();return;}
  const generation=++renderGeneration;
  let savedError='',next=null;const moving=library.migration();
  try{await library.list();}catch(e){savedError=libraryError=e.message;}
  if(epoch!==authGeneration||generation!==renderGeneration)return;
  if(moving?.score)next=moving.score;
  else{
   if(moving?.error)savedError=moving.error;
   if(library.scores.length)try{next=await library.open(library.scores[0].id);}catch(e){savedError=e.message;}
  }
  if(epoch!==authGeneration||generation!==renderGeneration)return;
  if(next)try{await loadScore(next,generation);}catch(e){savedError=`Saved score could not be restored: ${e.message}. The saved copy was retained.`;}
  if(epoch!==authGeneration||generation!==renderGeneration)return;
  if(!score){const r=await fetch('/sample.musicxml',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Score preview could not be loaded');const xml=await r.text();if(epoch!==authGeneration||generation!==renderGeneration)return;await loadScore({xml,preview:true},generation);}
  if(savedError)error(savedError);
  showLibrary();updateConnection();poll();
 }catch(e){if(epoch===authGeneration){$('#auth-error').textContent=e.message;error(e.message);}}
}
document.addEventListener('DOMContentLoaded',()=>{
 if(!window.ScoreSignIn){$('#signed-out').hidden=false;$('#auth-error').textContent='Sign-in interface could not load. Reload to try again.';return;}
 auth=ScoreSignIn.init({headerEl:'#auth-area',landingButtonsEl:'#auth-buttons',showWhenLoggedIn:'#signed-in',showWhenLoggedOut:'#signed-out',onLogin:()=>setTimeout(signedIn,0),onLogout:()=>{stopLearning('',false);pitch.stop();stage.close();stage.awake(false);++authGeneration;++renderGeneration;library?.reset('');libraryError='';$('#score-library')?.remove();loading=false;$('#score-file').disabled=false;inspecting=false;disconnectSpotify();subject='';score=null;entries=[];entryTimes=[];renderer?.clear();renderer=null;$('#score').replaceChildren();resetCursor();}});
 window.auth=auth;library=createLibrary((url,options)=>auth.fetchWithAuth(url,options));
});
document.addEventListener('visibilitychange',()=>{if(stage.floating())return;if(document.hidden){pitch.stop();++pollGeneration;clearTimeout(pollTimer);snapshot=null;resetCursor();}else if(subject)poll();});
window.addEventListener('resize',()=>{if(stage.floating())return;clearTimeout(resizeTimer);resizeTimer=setTimeout(rerender,250);});
setInterval(()=>{if(subject&&!document.hidden&&!stage.floating())updateFollow();},100);
$('#mic').addEventListener('change',()=>{if($('#mic').checked){error('');$('#pitch-reading').hidden=false;showPitch(null);pitch.start();}else pitch.stop();});
