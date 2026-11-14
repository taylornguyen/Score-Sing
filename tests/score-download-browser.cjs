const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {once}=require('node:events');
const assert=require('node:assert/strict');
const cwd=process.cwd();
async function unusedPort(){
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;
}
(async()=>{
 const port=await unusedPort(),origin=`http://127.0.0.1:${port}`,env={...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'};
 delete env.SCORE_SING_LOGIN_PASSWORD;delete env.SCORE_SING_AUTH_SECRET;
 const server=spawn(process.execPath,['server.js'],{cwd,env,stdio:['ignore','pipe','inherit']});
 let output='';server.stdout.setEncoding('utf8');server.stdout.on('data',chunk=>output+=chunk);
 let browser;
 try{
  let ready=false;
  for(let i=0;i<80&&!ready;i++){
   try{ready=(await fetch(`${origin}/api/login`)).status===405;}catch{}
   if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(ready,true,'local server starts without credentials');
  const code=output.match(/Local access code \(this run only\): ([A-Za-z0-9_-]+)/)?.[1];
  assert.match(code||'',/^[A-Za-z0-9_-]{32}$/);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
  await page.goto(origin);
  await page.locator('#auth-buttons input[name=password]').fill(code);
  await page.locator('#auth-buttons button').click();
  await page.waitForSelector('#score svg',{timeout:20000});
  await page.waitForFunction(()=>!document.querySelector('#download-musicxml').disabled);

  const filePromise=page.waitForEvent('download');await page.click('#download-musicxml');
  const file=await filePromise,xml=require('node:fs').readFileSync(await file.path(),'utf8');
  assert.equal(file.suggestedFilename(),'Ode-to-Joy.musicxml');
  assert.match(xml,/^<\?xml version="1\.0" encoding="UTF-8"\?><score-partwise/);

  await page.evaluate(()=>window.print=()=>{window.__printRequested=true;});
  await page.click('#download-pdf');assert.equal(await page.evaluate(()=>window.__printRequested),true);
  await page.emulateMedia({media:'print'});
  const printStyle=await page.evaluate(()=>({score:getComputedStyle(document.querySelector('#score')).display,tools:getComputedStyle(document.querySelector('.score-toolbar .tools')).display,transport:getComputedStyle(document.querySelector('.transport')).display}));
  assert.deepEqual(printStyle,{score:'block',tools:'none',transport:'none'});
  const pdf=await page.pdf({printBackground:true});
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
  await page.emulateMedia({media:'screen'});await context.close();
  console.log('MusicXML download and printable PDF passed');
 }finally{
  if(browser)await browser.close();
  if(server.exitCode===null){server.kill();await once(server,'exit');}
 }
})().catch(error=>{console.error(error);process.exit(1);});
