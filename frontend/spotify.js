const AUTH='https://accounts.spotify.com/authorize',TOKEN='https://accounts.spotify.com/api/token';
export const CLIENT_ID='283d3d54be16465ca3d51e898f78c037';
const key='score-sing-spotify',pendingKey='score-sing-pkce';
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id);
let generation=0,refreshing=null,reading=null,retryAt=0;
const requests=new Set();
const cancelled=()=>new DOMException('Spotify connection changed. Start again.','AbortError');
function saved(){
 try{
  const s=JSON.parse(sessionStorage.getItem(key)||'null');
  if(s&&typeof s.access_token==='string'&&s.access_token&&validId(s.clientId)&&Number.isFinite(s.expiresAt))return s;
 }catch{}
 sessionStorage.removeItem(key);return null;
}
function rateLimit(seconds){const e=Error('Spotify is rate limiting requests');e.status=429;e.retryAfter=Math.max(1,Math.ceil(seconds));return e;}
async function request(url,options={}){
 if(Date.now()<retryAt)throw rateLimit((retryAt-Date.now())/1000);
 const epoch=generation,controller=new AbortController();requests.add(controller);
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(12000),...(options.signal?[options.signal]:[])]);
 try{
  const res=await fetch(url,{...options,signal});
  if(epoch!==generation)throw cancelled();
  if(!res.ok){
   const e=Error(`Spotify request failed (${res.status})`);e.status=res.status;
   if(res.status===429){
    const header=res.headers.get('retry-after');let wait=Number(header);
    if(!header||!Number.isFinite(wait))wait=(Date.parse(header)-Date.now())/1000;
    if(!Number.isFinite(wait)||wait<=0)wait=5;
    retryAt=Date.now()+wait*1000;throw rateLimit(wait);
   }
   throw e;
  }
  const data=res.status===204?null:await res.json();
  if(epoch!==generation)throw cancelled();
  return data;
 }finally{requests.delete(controller);}
}
function storeToken(t,clientId,previous={}){
 if(!t||typeof t.access_token!=='string'||!t.access_token||!Number.isFinite(t.expires_in)||t.expires_in<=0||(t.token_type&&t.token_type.toLowerCase()!=='bearer'))throw Error('Spotify returned an incomplete access token. Connect again.');
 const s={...previous,...t,clientId,expiresAt:Date.now()+t.expires_in*1000};sessionStorage.setItem(key,JSON.stringify(s));return s;
}
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function isConnected(){return !!saved();}
export function disconnect(){
 generation++;for(const request of requests)request.abort();requests.clear();refreshing=null;reading=null;
 sessionStorage.removeItem(key);sessionStorage.removeItem(pendingKey);
}
// Spotify's login refuses to load in a frame, so an embedded app signs in through a pop-up.
const POPUP_STATE='p.',CALLBACK_MESSAGE='score-sing-spotify-callback';
function framed(){try{return !!globalThis.top&&globalThis.top!==globalThis.self;}catch{return true;}}
export async function connect(clientId=CLIENT_ID){
 if(!validId(clientId))throw Error('Spotify client ID is not configured');
 disconnect();
 // Opened before any await so the click still counts as the user's gesture.
 const popup=framed()?globalThis.open('','score-sing-spotify','popup,width=520,height=760'):null;
 if(framed()&&!popup)throw Error('Allow pop-ups for Score Sing to connect Spotify');
 try{
  const epoch=generation,verifier=encode(crypto.getRandomValues(new Uint8Array(64))),state=(popup?POPUP_STATE:'')+encode(crypto.getRandomValues(new Uint8Array(24)));
  const redirect=location.origin+'/callback.html';
  const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  if(epoch!==generation)throw cancelled();
  sessionStorage.setItem(pendingKey,JSON.stringify({verifier,state,clientId,redirect,created:Date.now()}));
  const url=AUTH+'?'+new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirect,scope:'user-read-currently-playing',code_challenge_method:'S256',code_challenge:challenge,state});
  if(!popup){location.assign(url);return false;}
  popup.location.href=url;
  const params=await awaitPopup(popup,epoch);
  await finish(params);return true;
 }catch(e){popup?.close();throw e;}
}
function awaitPopup(popup,epoch){
 return new Promise((resolve,reject)=>{
  const started=Date.now();
  const done=()=>{removeEventListener('message',onMessage);clearInterval(watch);};
  const onMessage=event=>{
   if(event.origin!==location.origin||event.source!==popup||event.data?.type!==CALLBACK_MESSAGE||typeof event.data.search!=='string')return;
   done();popup.close();resolve(new URLSearchParams(event.data.search));
  };
  const watch=setInterval(()=>{
   if(epoch!==generation){done();reject(cancelled());}
   else if(popup.closed){done();reject(Error('Spotify window closed before connecting. Start again.'));}
   else if(Date.now()-started>600000){done();popup.close();reject(Error('Spotify connection timed out. Start again.'));}
  },500);
  addEventListener('message',onMessage);
 });
}
async function finish(params){
 const epoch=generation;let pending;
 try{pending=JSON.parse(sessionStorage.getItem(pendingKey)||'null');}catch{}
 sessionStorage.removeItem(pendingKey);
 const age=Date.now()-pending?.created;
 if(!pending||!validId(pending.clientId)||typeof pending.verifier!=='string'||pending.verifier.length<43||pending.redirect!==location.origin+'/callback.html'||!Number.isFinite(age)||age<0||age>600000||params.get('state')!==pending.state)throw Error('Spotify connection expired or did not match this browser. Start again.');
 if(params.has('error'))throw Error('Spotify connection was declined. Start again when ready.');
 if(!params.get('code'))throw Error('Spotify did not return an authorization code');
 const body=new URLSearchParams({client_id:pending.clientId,grant_type:'authorization_code',code:params.get('code'),redirect_uri:pending.redirect,code_verifier:pending.verifier});
 const token=await request(TOKEN,{method:'POST',body});
 if(epoch!==generation)throw cancelled();storeToken(token,pending.clientId);
}
// Returns true when this window was a pop-up that handed the result back to the embedded app.
export async function callback(){
 const search=location.search,params=new URLSearchParams(search);
 history.replaceState(null,'',location.pathname);
 if(params.get('state')?.startsWith(POPUP_STATE)){
  if(!globalThis.opener)throw Error('Score Sing closed before Spotify finished. Start again.');
  globalThis.opener.postMessage({type:CALLBACK_MESSAGE,search},location.origin);return true;
 }
 await finish(params);location.replace('/');return false;
}
async function token(signal){
 let s=saved();if(!s)throw Error('Connect Spotify to follow playback');
 if(s.expiresAt<Date.now()+60000){
  if(!s.refresh_token){disconnect();throw Error('Spotify access expired. Connect again.');}
  if(!refreshing){
   const epoch=generation;
   const pending=(async()=>{
    try{
     const t=await request(TOKEN,{method:'POST',signal,body:new URLSearchParams({grant_type:'refresh_token',refresh_token:s.refresh_token,client_id:s.clientId})});
     if(epoch!==generation)throw cancelled();return storeToken(t,s.clientId,s);
    }catch(e){if(epoch===generation&&(e.status===400||e.status===401))disconnect();throw e;}
   })();refreshing=pending;
   pending.finally(()=>{if(refreshing===pending)refreshing=null;}).catch(()=>{});
  }
  s=await refreshing;
 }
 return s.access_token;
}
export function playback(){
 if(reading)return reading;
 const epoch=generation,signal=AbortSignal.timeout(15000);
 const pending=(async()=>{
  const access=await token(signal);if(epoch!==generation)throw cancelled();
  const data=await request('https://api.spotify.com/v1/me/player/currently-playing',{signal,headers:{Authorization:'Bearer '+access}});
  if(!data||data.currently_playing_type!=='track'||!data.item||data.item.is_local)return null;
  if(typeof data.item.id!=='string'||typeof data.item.name!=='string'||!Array.isArray(data.item.artists)||data.item.artists.some(a=>!a||typeof a.name!=='string')||typeof data.is_playing!=='boolean')throw Error('Spotify returned incomplete playback data');
  return {...data,receivedAt:performance.now()};
 })();reading=pending;
 pending.finally(()=>{if(reading===pending)reading=null;}).catch(()=>{});
 return pending;
}
