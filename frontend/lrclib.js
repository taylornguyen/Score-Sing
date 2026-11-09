// Time-synced lyrics from LRCLIB (public, no key). Only the song's title, artist, album and length are sent.
const API='https://lrclib.net/api';

// Strict LRC: "[mm:ss.xx] text" lines; metadata tags and blank lines are skipped.
export function parseLrc(text){
 if(typeof text!=='string')throw Error('Synced lyrics are missing');
 const lines=[];
 for(const raw of text.split(/\r?\n/)){
  const stamps=[...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
  if(!stamps.length||raw.search(/\[\d/)!==0)continue;
  const words=raw.slice(stamps.at(-1).index+stamps.at(-1)[0].length).trim();
  for(const [,m,s,f] of stamps){
   const seconds=Number(m)*60+Number(s)+(f?Number(f)/10**f.length:0);
   if(Number(s)>=60||!Number.isFinite(seconds))throw Error('Synced lyrics have an invalid time');
   if(words)lines.push({seconds,text:words});
  }
 }
 lines.sort((a,b)=>a.seconds-b.seconds);
 if(lines.length<2)throw Error('Synced lyrics have too few timed lines');
 return lines;
}

async function getJson(url,signal){
 const res=await fetch(url,{signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])])});
 if(res.status===404)return null;
 if(!res.ok)throw Error(`Lyrics service failed (${res.status})`);
 return res.json();
}

// Returns {state:'found',lines,source}|{state:'instrumental'|'unsynced'|'missing'}; network faults throw.
export async function syncedLyrics({title,artist,album,durationMs},signal){
 if(!title||!artist)throw Error('Song title and artist are required for lyrics');
 const seconds=Number.isFinite(durationMs)?Math.round(durationMs/1000):null;
 let records=[];
 try{
  const exact=await getJson(`${API}/get?`+new URLSearchParams({track_name:title,artist_name:artist,...(album?{album_name:album}:{}),...(seconds?{duration:String(seconds)}:{})}),signal);
  if(exact)records=[exact];
  else{
   const found=await getJson(`${API}/search?`+new URLSearchParams({track_name:title,artist_name:artist}),signal);
   if(Array.isArray(found))records=found.filter(r=>!seconds||!Number.isFinite(r?.duration)||Math.abs(r.duration-seconds)<=8)
    .sort((a,b)=>Math.abs((a.duration??seconds)-seconds)-Math.abs((b.duration??seconds)-seconds));
  }
 }catch(e){
  if(e.name==='TimeoutError')throw Error('Lyrics service timed out');
  throw e;
 }
 const synced=records.find(r=>typeof r?.syncedLyrics==='string'&&r.syncedLyrics.trim());
 if(synced)return {state:'found',lines:parseLrc(synced.syncedLyrics),source:`LRCLIB #${synced.id}`};
 if(records.some(r=>r?.instrumental))return {state:'instrumental'};
 if(records.some(r=>typeof r?.plainLyrics==='string'&&r.plainLyrics.trim()))return {state:'unsynced'};
 return {state:'missing'};
}
