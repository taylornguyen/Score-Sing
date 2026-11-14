// The chat opens apps in a sandboxed frame; Spotify's login refuses frames, so Connect must use a pop-up.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {authScript,startLibrary}=require('./library-fixture.cjs');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'};
(async()=>{
const library=await startLibrary(),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 let tokenCalls=0;const errors=[];
 await context.route('https://chat.test/',r=>r.fulfill({contentType:'text/html',body:'<iframe id="app" src="https://score-sing.test/" style="width:1200px;height:850px" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>'}));
 await context.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:authScript("'embedded'")}));
 // Stand-in for Spotify's consent: it returns the code to the registered callback.
 await context.route(/^https:\/\/accounts\.spotify\.com\/authorize/,r=>{
  const u=new URL(r.request().url());
  const back=u.searchParams.get('redirect_uri')+'?code=granted&state='+encodeURIComponent(u.searchParams.get('state'));
  return r.fulfill({contentType:'text/html',body:`<script>location.replace(${JSON.stringify(back)})</script>`});
 });
 await context.route('https://accounts.spotify.com/api/token',r=>{tokenCalls++;return r.fulfill({json:{access_token:'framed-token',token_type:'Bearer',expires_in:3600}});});
 await context.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:4000,is_playing:true,item:{id:'1'.repeat(22),name:'Embedded recording',artists:[{name:'Test artist'}]}}}));
 await context.route('https://score-sing.test/**',async r=>{
  const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
  try{const body=await fs.readFile(file);await r.fulfill({body,contentType:types[path.extname(file)]||'text/plain'});}catch{await r.fulfill({status:404});}
 });
 await library.route(context);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://chat.test/');
 const app=page.frameLocator('#app');
 await app.locator('#connect').waitFor({state:'visible',timeout:20000});
 const [popup]=await Promise.all([page.waitForEvent('popup',{timeout:10000}),app.locator('#connect').click()]);
 await popup.waitForEvent('close',{timeout:15000});
 await app.locator('#track-title').filter({hasText:'Embedded recording'}).waitFor({timeout:15000});
 assert.equal(tokenCalls,1,'the embedded app exchanged the code once');
 assert.equal(await app.locator('#disconnect').isVisible(),true);
 assert.equal(page.frames().find(f=>f.url().startsWith('https://score-sing.test')).url(),'https://score-sing.test/','frame never navigated to Spotify');
 assert.deepEqual(errors,[]);
 console.log('embedded: Connect Spotify through pop-up, playback follows in frame, passed');
}finally{await browser.close();await library.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
