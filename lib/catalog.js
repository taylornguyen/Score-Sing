// Song catalog built by scripts/build-catalog.py: finds scores for a Spotify song by title and artist.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {HttpError} from './http.js';

export const DEFAULT_CATALOG_DIR='/home/ubuntu/.local/share/score-sing/catalog';
const VERSION_WORDS=/\b(remaster(ed)?|live|version|edit|mix|mono|stereo|acoustic|demo|single|radio|from|feat|featuring|bonus|deluxe|instrumental|karaoke|original|soundtrack|anniversary)\b/;
const STOP=new Set(['the','a','an','of','to','and','in','on','my','me','you','i','it','is','be','for','your','o']);
const MIN_TITLE=0.75;

export function normalize(value){
 return String(value||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/['’]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
// "Yesterday - Remastered 2009", "Song (feat. X)" and "[Live]" all name the song "yesterday"/"song".
export function songTitle(value){
 let title=String(value||'').replace(/\s*[([][^)\]]*[)\]]/g,' ');
 const dash=title.split(/\s+[-–—]\s+/);
 if(dash.length>1&&VERSION_WORDS.test(normalize(dash.slice(1).join(' '))))title=dash[0];
 title=title.replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i,'');
 return normalize(title);
}
const tokens=value=>normalize(value).split(' ').filter(Boolean);
function dice(a,b){
 if(!a.length||!b.length)return 0;
 const right=[...b];let shared=0;
 for(const token of a){const i=right.indexOf(token);if(i>=0){shared++;right.splice(i,1);}}
 return 2*shared/(a.length+b.length);
}
// Catalog titles are often "Song - Artist" or "Song by Artist"; compare against each plausible song part.
function titleScore(query,entry){
 const options=new Set([songTitle(entry.song),songTitle(entry.title)]);
 for(const raw of [entry.song,entry.title])for(const part of String(raw||'').split(/\s+[-–—|]\s+|\s+by\s+/i))options.add(songTitle(part));
 let best=0;
 for(const option of options){if(!option)continue;if(option===query)return 1;best=Math.max(best,dice(query.split(' '),option.split(' ')));}
 return best;
}
function artistScore(artists,entry){
 const text=` ${normalize([entry.artist,entry.composer,entry.title].join(' '))} `;
 let best=entry.artist?0:0.3;
 for(const artist of artists){
  const parts=tokens(artist).filter(t=>!STOP.has(t)||tokens(artist).length===1);
  if(!parts.length)continue;
  const found=parts.filter(t=>text.includes(` ${t} `)).length/parts.length;
  best=Math.max(best,found===1?1:found*0.6);
 }
 return best;
}

export function createCatalog({dir=process.env.SCORE_SING_CATALOG_DIR||DEFAULT_CATALOG_DIR}={}){
 let loaded=null,loadError=null;
 function load(){
  if(loaded)return loaded;
  try{
   const index=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
   if(index?.schemaVersion!==1||!Array.isArray(index.entries))throw Error('Catalog index has an unknown format');
   const byToken=new Map(),byId=new Map();
   for(const entry of index.entries){
    byId.set(entry.id,entry);
    for(const token of new Set(tokens(`${entry.song} ${entry.title}`)))(byToken.get(token)||byToken.set(token,[]).get(token)).push(entry);
   }
   const maxViews=Math.log1p(Math.max(1,...index.entries.map(e=>e.views||0)));
   loaded={index,byToken,byId,maxViews};loadError=null;return loaded;
  }catch(error){loadError=error.code==='ENOENT'?'Score catalog is not installed':error.message;return null;}
 }
 function ready(){const catalog=load();if(!catalog)throw new HttpError(503,loadError);return catalog;}
 return {
  health(){const catalog=load();return catalog?{status:'ok',entries:catalog.index.entries.length}:{status:'unavailable',error:loadError};},
  match({title,artists=[],limit=5}){
   const query=songTitle(title);
   if(!query)throw new HttpError(400,'Song title is required');
   if(!Array.isArray(artists)||artists.some(a=>typeof a!=='string'))throw new HttpError(400,'Artists must be text');
   const catalog=ready();
   const queryTokens=query.split(' '),content=queryTokens.filter(t=>!STOP.has(t));
   const seen=new Set(),results=[];
   for(const token of content.length?content:queryTokens)for(const entry of catalog.byToken.get(token)||[]){
    if(seen.has(entry.id))continue;seen.add(entry.id);
    const t=titleScore(query,entry);if(t<MIN_TITLE)continue;
    const a=artistScore(artists,entry);
    // A near title by someone else ("Let It Be" vs "Let it be now" by another writer) is another song.
    if(t<1&&a===0)continue;
    const popularity=Math.log1p(entry.views||0)/catalog.maxViews;
    // Lead sheets and voice+piano scores are easier to sing from than full arrangements.
    const singable=entry.tracks>0&&entry.tracks<=2?1:entry.tracks<=4?0.5:0;
    const score=0.55*t+0.3*a+0.08*popularity+0.04*singable+0.03*(entry.best?1:0);
    const reasons=[t===1?'exact title':'similar title',a===1?'artist matches':a>0.3?'artist partly matches':a===0.3?'artist not listed':'artist differs'];
    results.push({id:entry.id,title:entry.song||entry.title,artist:entry.artist,arranger:entry.composer,license:entry.license,licenseConflict:entry.licenseConflict,score:Math.round(score*1000)/1000,artistMatch:a,reasons});
   }
   // A different artist with the same title is usually another song; keep it only if nothing better exists.
   results.sort((x,y)=>(y.artistMatch>=0.3)-(x.artistMatch>=0.3)||y.score-x.score);
   return results.slice(0,limit).map(({artistMatch,...rest})=>({...rest,artistConfirmed:artistMatch===1}));
  },
  async file(id){
   if(typeof id!=='string'||!/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(id))throw new HttpError(400,'Invalid score id');
   const catalog=ready();if(!catalog.byId.has(id))throw new HttpError(404,'Score not found');
   try{return await fsp.readFile(path.join(dir,'mxl',id+'.mxl'));}
   catch(error){throw new HttpError(error.code==='ENOENT'?503:500,'Score file is missing from the catalog');}
  },
 };
}

export function createCatalogHandler({verify,catalog}){
 return async function(req,res,pathname){
  if(!pathname.startsWith('/api/catalog/'))return false;
  const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);};
  try{
   try{await verify((req.headers.authorization||'').replace(/^Bearer /,''));}catch{throw new HttpError(401,'Sign in to Score Sing');}
   if(req.method!=='GET')throw new HttpError(405,'Use GET');
   const url=new URL(req.url,'http://localhost');
   if(pathname==='/api/catalog/match'){send(200,{candidates:catalog.match({title:url.searchParams.get('title'),artists:url.searchParams.getAll('artist')})});return true;}
   const file=pathname.match(/^\/api\/catalog\/score\/([^/]+)$/);
   if(file){send(200,await catalog.file(decodeURIComponent(file[1])),'application/vnd.recordare.musicxml');return true;}
   throw new HttpError(404,'Not found');
  }catch(error){send(error.status||500,{error:error.status?error.message:'Score catalog failed'});return true;}
 };
}
