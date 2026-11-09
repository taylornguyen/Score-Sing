import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
let counter=0;
async function setup(token={}){
 globalThis.sessionStorage=storage();globalThis.localStorage=storage();
 globalThis.location={origin:'https://score-sing.test',pathname:'/callback.html',search:'',assign:u=>{location.assigned=u;},replace:u=>{location.replaced=u;}};
 globalThis.history={replaceState:()=>{}};
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
 sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'old-token',refresh_token:'refresh',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000,...token}));
 return import('../frontend/spotify.js?test='+counter++);
}
const ok=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const track={currently_playing_type:'track',progress_ms:12000,is_playing:true,item:{id:'1'.repeat(22),name:'Fixture',artists:[{name:'Artist'}]}};
test('parallel reads share one fetch and complete with playback state',async()=>{
 const s=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return ok(track);};
 const [a,b]=await Promise.all([s.playback(),s.playback()]);assert.equal(calls,1);assert.equal(a,b);assert.equal(a.progress_ms,12000);
});
test('refresh preserves refresh token if omitted in rotation',async()=>{
 const s=await setup({expiresAt:1});let calls=0;globalThis.fetch=async u=>{calls++;return ok(u.includes('/api/token')?{access_token:'new-token',expires_in:3600,token_type:'Bearer'}:track);};
 await s.playback();assert.equal(calls,2);assert.equal(JSON.parse(sessionStorage.getItem('score-sing-spotify')).refresh_token,'refresh');
});
test('disconnect aborts refresh and cannot resurrect tokens',async()=>{
 const s=await setup({expiresAt:1});let finish;
 globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
 const reading=s.playback();await new Promise(resolve=>setImmediate(resolve));s.disconnect();finish(ok({access_token:'new-token',expires_in:3600}));
 await assert.rejects(reading,/connection changed/);assert.equal(s.isConnected(),false);
});
test('rate limit survives another read without upstream request',async()=>{
 const s=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});};
 await assert.rejects(s.playback(),e=>e.status===429&&e.retryAfter===120);
 await assert.rejects(s.playback(),e=>e.status===429&&e.retryAfter>=119);assert.equal(calls,1);
});
test('revoked refresh disconnects visibly',async()=>{
 const s=await setup({expiresAt:1});globalThis.fetch=async()=>new Response('',{status:400});
 await assert.rejects(s.playback(),e=>e.status===400);assert.equal(s.isConnected(),false);
});
test('malformed token storage does not count as a connection',async()=>{
 const s=await setup({expiresAt:null});assert.equal(s.isConnected(),false);
 sessionStorage.setItem('score-sing-spotify','{broken');assert.equal(s.isConnected(),false);
});
test('PKCE challenge and callback require current state, host and valid token response',async()=>{
 const s=await setup();await s.connect('a'.repeat(32));const auth=new URL(location.assigned);
 assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('scope'),'user-read-currently-playing');
 location.search='?state='+auth.searchParams.get('state')+'&code=returned-code';
 globalThis.fetch=async()=>ok({access_token:'authorized',expires_in:3600,token_type:'Bearer',refresh_token:'refresh'});
 await s.callback();assert.equal(location.replaced,'/');assert.equal(s.isConnected(),true);assert.equal(sessionStorage.getItem('score-sing-pkce'),null);
 await assert.rejects(s.callback(),/expired or did not match/);
});
test('callback rejects malformed saved verifier before network',async()=>{
 const s=await setup();sessionStorage.setItem('score-sing-pkce','{broken');let calls=0;globalThis.fetch=async()=>{calls++;return ok({});};
 await assert.rejects(s.callback(),/expired or did not match/);assert.equal(calls,0);
});
test('a successful status with malformed token cannot create a session',async()=>{
 const s=await setup();await s.connect('b'.repeat(32));const pending=JSON.parse(sessionStorage.getItem('score-sing-pkce'));location.search='?state='+pending.state+'&code=bad-token';
 globalThis.fetch=async()=>ok({expires_in:3600});await assert.rejects(s.callback(),/incomplete access token/);assert.equal(s.isConnected(),false);
});
test('HTTP-date retry ownership prevents immediate refocus retry',async()=>{
 const s=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':new Date(Date.now()+120000).toUTCString()}});};
 await assert.rejects(s.playback(),e=>e.status===429&&e.retryAfter>=118);
 await assert.rejects(s.playback(),e=>e.status===429);assert.equal(calls,1);
});
test('invalid playback metadata fails visibly rather than crashing the UI',async()=>{
 const s=await setup();globalThis.fetch=async()=>ok({...track,item:{...track.item,artists:[null]}});
 await assert.rejects(s.playback(),/incomplete playback data/);
});
test('no active song is a completed empty state',async()=>{
 const s=await setup();globalThis.fetch=async()=>new Response(null,{status:204});assert.equal(await s.playback(),null);
});
test('connect uses the configured client ID and exact redirect without a setup form',async()=>{
 const s=await setup();await s.connect();const auth=new URL(location.assigned);
 assert.equal(auth.searchParams.get('client_id'),'283d3d54be16465ca3d51e898f78c037');
 assert.equal(auth.searchParams.get('redirect_uri'),'https://score-sing.test/callback.html');
 assert.equal(JSON.parse(sessionStorage.getItem('score-sing-pkce')).clientId,s.CLIENT_ID);
 await assert.rejects(s.connect('not-an-id'),/not configured/);
});
function embed(popup){
 const listeners=new Set();
 Object.assign(globalThis,{top:{},self:globalThis,open:()=>popup,addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn)});
 return {listeners,send:data=>{for(const fn of [...listeners])fn({origin:'https://score-sing.test',source:popup,data});},
  restore(){for(const key of ['top','self','open','addEventListener','removeEventListener','opener'])delete globalThis[key];}};
}
const fakePopup=()=>({location:{},closed:false,close(){this.closed=true;}});
test('embedded app connects through a pop-up because Spotify refuses frames',async()=>{
 const s=await setup(),popup=fakePopup(),frame=embed(popup);
 try{
  let posted=0;globalThis.fetch=async()=>{posted++;return ok({access_token:'framed',expires_in:3600,token_type:'Bearer'});};
  const connecting=s.connect();await new Promise(resolve=>setTimeout(resolve,20));
  const auth=new URL(popup.location.href);assert.equal(location.assigned,undefined,'embedded frame never navigates to Spotify');
  const state=auth.searchParams.get('state');assert.match(state,/^p\./);
  frame.send({type:'other',search:'?state='+state+'&code=x'});
  frame.listeners.forEach(fn=>fn({origin:'https://attacker.test',source:popup,data:{type:'score-sing-spotify-callback',search:'?state='+state+'&code=x'}}));
  assert.equal(posted,0,'foreign origins and messages are ignored');
  frame.send({type:'score-sing-spotify-callback',search:'?state='+state+'&code=returned'});
  assert.equal(await connecting,true);assert.equal(s.isConnected(),true);assert.equal(popup.closed,true);assert.equal(frame.listeners.size,0);
 }finally{frame.restore();}
});
test('embedded connect fails visibly when pop-ups are blocked or the window closes',async()=>{
 const s=await setup(),frame=embed(null);
 try{await assert.rejects(s.connect(),/Allow pop-ups/);}finally{frame.restore();}
 const s2=await setup(),popup=fakePopup(),frame2=embed(popup);
 try{const connecting=s2.connect();await new Promise(resolve=>setTimeout(resolve,20));popup.closed=true;
  await assert.rejects(connecting,/closed before connecting/);assert.equal(s2.isConnected(),false);assert.equal(frame2.listeners.size,0);}
 finally{frame2.restore();}
});
test('pop-up callback hands Spotify result to the embedded app without exchanging it',async()=>{
 const s=await setup();const messages=[];globalThis.opener={postMessage:(data,origin)=>messages.push({data,origin})};
 try{
  let calls=0;globalThis.fetch=async()=>{calls++;return ok({});};
  location.search='?state=p.abc&code=returned';
  assert.equal(await s.callback(),true);assert.equal(calls,0);assert.equal(location.replaced,undefined);
  assert.deepEqual(messages,[{data:{type:'score-sing-spotify-callback',search:'?state=p.abc&code=returned'},origin:'https://score-sing.test'}]);
  delete globalThis.opener;await assert.rejects(s.callback(),/closed before Spotify finished/);
 }finally{delete globalThis.opener;}
});
