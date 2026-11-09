// Finds catalog scores for the playing Spotify song (see lib/catalog.js) and reads their first-verse lyrics.
import {readScoreFile} from './score-file.js';

// Best first; an empty list means the catalog has no score for this song. Failures throw with a visible reason.
export async function catalogCandidates(fetchWithAuth,track){
 const query=new URLSearchParams({title:track.name});
 for(const artist of track.artists||[])if(artist?.name)query.append('artist',artist.name);
 let response;
 try{response=await fetchWithAuth('/api/catalog/match?'+query,{signal:AbortSignal.timeout(10000)});}
 catch(e){throw Error(e?.name==='TimeoutError'?'Score search timed out':'Score search failed');}
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(data?.error||`Score search failed (${response.status})`);
 if(!Array.isArray(data?.candidates))throw Error('Score search returned an invalid list');
 return data.candidates;
}

export async function downloadScore(fetchWithAuth,candidate){
 let file;
 try{file=await fetchWithAuth('/api/catalog/score/'+encodeURIComponent(candidate.id),{signal:AbortSignal.timeout(20000)});}
 catch(e){throw Error(e?.name==='TimeoutError'?'Score download timed out':'Score download failed');}
 if(!file.ok)throw Error((await file.json().catch(()=>null))?.error||`Score download failed (${file.status})`);
 return readScoreFile(new File([await file.blob()],candidate.id+'.mxl'));
}

// First verse of the first part that has lyrics, in the {lyric, wordStart} shape lyrics-align.js reads.
// Used to compare a score's words with the recording before rendering it; timing comes later from the rendered score.
export function xmlLyrics(xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 for(const part of doc.querySelectorAll('part')){
  const words=[];
  for(const note of part.querySelectorAll('note')){
   const lyrics=[...note.children].filter(e=>e.localName==='lyric');
   if(!lyrics.length)continue;
   const lyric=lyrics.sort((a,b)=>(Number(a.getAttribute('number'))||1)-(Number(b.getAttribute('number'))||1))[0];
   const text=[...lyric.children].filter(e=>e.localName==='text').map(e=>e.textContent).join('');
   const syllabic=[...lyric.children].find(e=>e.localName==='syllabic')?.textContent;
   if(text.trim())words.push({at:words.length,lyric:text,wordStart:syllabic!=='middle'&&syllabic!=='end'});
  }
  if(words.length)return words;
 }
 return [];
}
