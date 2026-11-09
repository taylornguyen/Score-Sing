import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createExportHandler} from '../lib/exports.js';
const token='a'.repeat(64),other='b'.repeat(64);
test('export links serve their files until they expire, and nothing else',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exports-'));let at=Date.parse('2026-11-09T20:00:00Z');
 for(const [t,expires] of [[token,'2026-11-10T20:00:00Z'],[other,'2026-11-09T19:00:00Z']]){fs.mkdirSync(path.join(dir,t));fs.writeFileSync(path.join(dir,t,'expires-at'),expires);fs.writeFileSync(path.join(dir,t,'code.zip'),'ZIPDATA');}
 fs.writeFileSync(path.join(dir,'secret.txt'),'no');
 const handle=createExportHandler({dir,now:()=>at});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res,new URL(req.url,'http://x').pathname)){res.writeHead(418);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const ok=await fetch(`${base}/download/${token}/code.zip`);
  assert.equal(ok.status,200);assert.equal(await ok.text(),'ZIPDATA');assert.match(ok.headers.get('content-disposition'),/attachment; filename="code.zip"/);
  for(const bad of [`/download/${other}/code.zip`,`/download/${token}/expires-at`,`/download/${token}/missing.zip`,`/download/${token}/..%2Fsecret.txt`,`/download/${'c'.repeat(64)}/code.zip`,'/download/short/code.zip'])
   assert.equal((await fetch(base+bad)).status,404,bad);
  const head=await fetch(`${base}/download/${token}/code.zip`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'7');
  assert.equal((await fetch(`${base}/download/${token}/code.zip`,{method:'POST'})).status,404);
  assert.equal((await fetch(`${base}/other`)).status,418,'other routes pass through');
  at=Date.parse('2026-11-11T00:00:00Z');assert.equal((await fetch(`${base}/download/${token}/code.zip`)).status,404,'expired');
 }finally{server.close();}
});
