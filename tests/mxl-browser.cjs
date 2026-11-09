const {chromium}=require('playwright');
const {zipSync,strToU8}=require('fflate');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext();const page=await context.newPage();
 const musicxml=await fs.readFile('frontend/sample.musicxml','utf8');
 await context.route('https://score-sing.test/**',async r=>{
  const url=new URL(r.request().url());
  if(url.pathname==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>MXL import regression</title>'});
  try{await r.fulfill({contentType:'text/javascript',body:await fs.readFile(path.join(process.cwd(),'frontend',url.pathname))});}catch{await r.fulfill({status:404});}
 });
 await page.goto('https://score-sing.test/');
 const container=prefix=>`<${prefix}container xmlns:c="urn:test"><${prefix}rootfiles><${prefix}rootfile full-path="nested/vocal.musicxml"/></${prefix}rootfiles></${prefix}container>`;
 for(const prefix of ['', 'c:']){
  const bytes=zipSync({'META-INF/container.xml':strToU8(container(prefix)),'nested/vocal.musicxml':strToU8(musicxml)});
  const xml=await page.evaluate(async bytes=>(await import('/score-file.js')).readScoreFile(new File([new Uint8Array(bytes)],'Vocal.mxl')),[...bytes]);assert.equal(xml,musicxml);
 }
 for(const [manifest,pattern] of [
  ['<container><rootfiles><rootfile full-path="missing.xml"/></rootfiles></container>',/missing or invalid/],
  ['<container><rootfiles>',/manifest is invalid/],
  ['<!DOCTYPE container [<!ENTITY ext "bad">]><container/>',/unsupported entities/],
  ['<container><rootfiles/></container>',/does not name/]
 ]){
  const bytes=zipSync({'META-INF/container.xml':strToU8(manifest),'nested/vocal.musicxml':strToU8(musicxml)});
  const error=await page.evaluate(async bytes=>{try{await (await import('/score-file.js')).readScoreFile(new File([new Uint8Array(bytes)],'Vocal.mxl'));return '';}catch(e){return e.message;}},[...bytes]);assert.match(error,pattern);
 }
 await context.route('https://score-sing.test/score-archive-worker.js',r=>r.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>{};'}));
 const timeoutResult=await page.evaluate(async()=>{const before=performance.now();try{await (await import('/score-file.js')).readScoreFile(new File([new Uint8Array([1,2,3])],'Stalled.mxl'));return {};}catch(e){return {error:e.message,elapsed:performance.now()-before};}});
 assert.match(timeoutResult.error,/reading timed out/);assert.ok(timeoutResult.elapsed>=14000&&timeoutResult.elapsed<18000);
 await page.waitForTimeout(100);assert.equal(page.workers().length,0,'stalled archive worker is terminated');
 console.log('MXL browser: standard/namespaced containers, nested score, missing root, malformed manifest, entity rejection and terminated timeout passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
