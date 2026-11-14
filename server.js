import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {verifier,issueToken,passwordMatches} from './lib/auth.js';
import {createVerificationStore} from './lib/verification.js';
import {readJson} from './lib/http.js';
import {createDatabase} from './lib/db.js';
import {createLibraryStore,createLibraryHandler} from './lib/library.js';
import {createCatalog,createCatalogHandler} from './lib/catalog.js';
import {createExportHandler} from './lib/exports.js';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'frontend');
const version=(await fs.readFile(path.join(root,'..','VERSION'),'utf8')).trim();
const port=Number(process.env.PORT||8080),host=process.env.HOST||'127.0.0.1';
const bindAddress=host.replace(/^\[|\]$/g,'').toLowerCase();
const loopback=bindAddress==='localhost'||bindAddress==='::1'||(isIP(bindAddress)===4&&bindAddress.startsWith('127.'));
let loginPassword=process.env.SCORE_SING_LOGIN_PASSWORD||'';
let authSecret=process.env.SCORE_SING_AUTH_SECRET||'';
const localCredentials=!loginPassword&&!authSecret&&loopback&&process.env.NODE_ENV!=='production';
if(localCredentials){
 loginPassword=randomBytes(24).toString('base64url');
 authSecret=randomBytes(48).toString('base64url');
 console.log(`Local access code (this run only): ${loginPassword}`);
}else{
 if(loginPassword.length<16)throw Error('Set SCORE_SING_LOGIN_PASSWORD to an access code of at least 16 characters');
 if(authSecret.length<32)throw Error('Set SCORE_SING_AUTH_SECRET to at least 32 characters');
}
const verify=verifier({secret:authSecret}),observations=createVerificationStore(),database=createDatabase();
const library=createLibraryHandler({verify,store:createLibraryStore(database)});
const catalog=createCatalog(),catalogRoutes=createCatalogHandler({verify,catalog}),exportRoutes=createExportHandler();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const loginFailures=new Map(),loginWindow=15*60*1000,loginLimit=8,tokenLifetime=60*60*8;
function failureFor(ip){
 const now=Date.now(),failure=loginFailures.get(ip);
 if(!failure||failure.until<=now){loginFailures.delete(ip);return null;}
 return failure;
}
function recordFailure(ip){
 const now=Date.now();
 for(const [key,value] of loginFailures)if(value.until<=now)loginFailures.delete(key);
 if(loginFailures.size>=1000&&!loginFailures.has(ip))loginFailures.delete(loginFailures.keys().next().value);
 const previous=failureFor(ip),failure=previous||{count:0,until:now+loginWindow};
 failure.count++;loginFailures.set(ip,failure);
}
const server=http.createServer(async(req,res)=>{
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(req.url==='/api/health')return json(200,{status:'ok',version,library:await database.health(),catalog:catalog.health()});
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/login'){
  if(req.method!=='POST')return json(405,{error:'Use POST'});
  let body;try{body=await readJson(req,{limit:1024,timeout:5000,label:'Login'});}catch(error){return json(error.status||400,{error:error.message});}
  if(!body||typeof body.password!=='string')return json(400,{error:'Enter your Score Sing access code'});
  const ip=req.socket.remoteAddress||'unknown',failure=failureFor(ip);
  if(failure&&failure.count>=loginLimit){res.setHeader('Retry-After',Math.ceil((failure.until-Date.now())/1000));return json(429,{error:'Too many sign-in attempts. Try again later.'});}
  if(!passwordMatches(body.password,loginPassword)){recordFailure(ip);return json(401,{error:'The access code is not valid'});}
  loginFailures.delete(ip);
  const token=await issueToken({subject:'score-sing-owner',secret:authSecret,ttlSeconds:tokenLifetime});
  return json(200,{token,expiresIn:tokenLifetime,subject:'score-sing-owner'});
 }
 if(await library(req,res,pathname))return;
 if(await catalogRoutes(req,res,pathname))return;
 if(await exportRoutes(req,res,pathname))return;
 if(req.url==='/api/session'){
  try{const p=await verify((req.headers.authorization||'').replace(/^Bearer /,''));return json(200,{authenticated:true,subject:p.sub});}
  catch{return json(401,{error:'Sign in to Score Sing'});}
 }
 if(req.url==='/api/verification'){
  let principal;try{principal=await verify((req.headers.authorization||'').replace(/^Bearer /,''));}catch{return json(401,{error:'Sign in to Score Sing'});}
  if(req.method==='GET')return json(200,{...observations.read(principal.sub),version});
  if(req.method==='POST'){
   try{observations.record(principal.sub,await readJson(req,{limit:2048,timeout:5000,label:'Verification'}));return json(202,{accepted:true});}
   catch(error){return json(error.status===413||error.status===408?error.status:400,{error:error.message});}
  }
  return json(405,{error:'Use GET or POST'});
 }
 if(req.url.startsWith('/api/'))return json(404,{error:'Not found'});
 try{
  const url=new URL(req.url,'http://localhost');let filename=decodeURIComponent(url.pathname);if(filename==='/')filename='/index.html';
  const file=path.resolve(root,'.'+filename);if(!file.startsWith(root+path.sep))return json(403,{error:'Forbidden'});
  const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);
 }catch{return json(404,{error:'Not found'});}
});
// Phone uploads of a 5 MB score need longer than ordinary API calls; each body read has its own deadline.
server.requestTimeout=60000;server.headersTimeout=10000;
server.listen(port,host,()=>console.log(`Score Sing ${version} listening on http://${host}:${server.address().port}`));
