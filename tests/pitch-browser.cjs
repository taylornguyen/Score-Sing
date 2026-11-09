const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {zipSync,strToU8}=require('fflate');
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
for(const [name,width,height,theme] of [['desktop',1440,1000,'dark'],['iphone',390,844,'light'],['denied',1440,1000,'dark']]){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
 await context.addInitScript(deny=>{
  window.__tracks=[];
  navigator.mediaDevices.getUserMedia=async()=>{
   if(deny)throw new DOMException('denied','NotAllowedError');
   const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();
   gain.gain.value=0.4;osc.connect(gain).connect(dest);osc.start();window.__osc=osc;window.__gain=gain;
   dest.stream.getTracks().forEach(t=>window.__tracks.push(t));return dest.stream;};
 },name==='denied');
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let progress=12000,playing=true,trackId='1'.repeat(22);
 await page.route('https://authreturn.com/static/auth_component.js',r=>r.fulfill({contentType:'text/javascript',body:`window.AuthReturn={init(o){window.fixtureAuth=o;document.querySelector(o.showWhenLoggedIn).hidden=false;setTimeout(o.onLogin,0);return {fetchWithAuth:async()=>({ok:true,json:async()=>({subject:'browser-fixture'})})}}};`}));
 await page.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:progress,is_playing:playing,item:{id:trackId,name:'Test recording',artists:[{name:'Test artist'}]}}}));
 await context.route('https://score-sing.test/**',async r=>{
  const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
  try{const b=await fs.readFile(file);const ext=path.extname(file);await r.fulfill({body:b,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'})[ext]||'text/plain'});}catch{await r.fulfill({status:404});}
 });
 await page.goto('https://score-sing.test/');
 await page.waitForSelector('#score svg',{timeout:20000});
 if(name==='denied'){
  await page.click('#mic');
  await page.waitForFunction(()=>!document.querySelector('#error').hidden);
  assert.equal(await page.locator('#error').textContent(),'Microphone access denied');
  assert.equal(await page.locator('#mic').isChecked(),false);assert.equal(await page.locator('#pitch-reading').isVisible(),false);
 }else{
  await page.evaluate(()=>sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'test-token',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000})));
  await page.reload();await page.waitForSelector('#score svg');await page.waitForFunction(()=>document.querySelector('#track-title').textContent==='Test recording');
  await page.check('#mic');await page.waitForFunction(()=>document.querySelector('#pitch-reading').textContent==='Mic on');
  await page.setInputFiles('#score-file','frontend/sample.musicxml');await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
  await page.click('#align-toggle');await page.click('#bind');
  playing=false;await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Paused · tempo-based',{timeout:7000});
  const note=await page.locator('#current-note').textContent();
  const names={C:0,'C♯':1,D:2,'E♭':3,E:4,F:5,'F♯':6,G:7,'A♭':8,A:9,'B♭':10,B:11};const m=/^(.+?)(-?\d+)$/.exec(note.split(' / ')[0]);
  const midi=names[m[1]]+12*(Number(m[2])+1),hz=440*2**((midi-69)/12);
  const setTone=c=>page.evaluate(f=>{window.__osc.frequency.value=f;},hz*2**(c/1200));
  await setTone(0);await page.waitForFunction(()=>/^In tune/.test(document.querySelector('#pitch-reading').textContent),null,{timeout:5000});
  await setTone(-1200+3);await page.waitForFunction(()=>/^In tune/.test(document.querySelector('#pitch-reading').textContent),null,{timeout:5000});
  await setTone(60);await page.waitForFunction(()=>/^Sharp \+(5\d|6\d)¢$/.test(document.querySelector('#pitch-reading').textContent),null,{timeout:5000});
  await setTone(-70);await page.waitForFunction(()=>/^Flat −(6\d|7\d)¢$/.test(document.querySelector('#pitch-reading').textContent),null,{timeout:5000});
  const colors=await page.locator('#pitch-reading').evaluate(el=>[getComputedStyle(el).color,getComputedStyle(document.querySelector('.note-panel')).color]);
  assert.ok(colors[0]!=='rgba(0, 0, 0, 0)');
  await page.evaluate(()=>{window.__gain.gain.value=0;});await page.waitForFunction(()=>document.querySelector('#pitch-reading').textContent==='Listening…',null,{timeout:5000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+': no horizontal overflow with mic on');
  await page.screenshot({path:`tests/pitch-${name}.png`});
  await page.uncheck('#mic');
  assert.equal(await page.evaluate(()=>window.__tracks.every(t=>t.readyState==='ended')),true,'mic tracks stopped on toggle off');
  assert.equal(await page.locator('#pitch-reading').isVisible(),false);
  await page.check('#mic');await page.waitForFunction(()=>window.__tracks.some(t=>t.readyState==='live'));
  await page.evaluate(()=>fixtureAuth.onLogout());
  await page.waitForFunction(()=>window.__tracks.every(t=>t.readyState==='ended'),null,{timeout:5000}).catch(()=>{throw Error('sign-out must stop the microphone');});
 }
 assert.deepEqual(errors,[],name+' page errors');
 console.log(name+': '+(name==='denied'?'denied microphone reported and reset':'mic pitch in tune/octave/sharp/flat/silence, stop on toggle and sign-out')+' passed');
 await context.close();
}
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
