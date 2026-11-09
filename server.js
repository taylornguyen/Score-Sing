import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifier} from './lib/auth.js';
import {createVerificationStore} from './lib/verification.js';
import {readJson} from './lib/http.js';
import {createDatabase} from './lib/db.js';
import {createLibraryStore,createLibraryHandler} from './lib/library.js';
import {createCatalog,createCatalogHandler} from './lib/catalog.js';
import {createExportHandler} from './lib/exports.js';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'frontend');
const version=(await fs.readFile(path.join(root,'..','VERSION'),'utf8')).trim();
const response=await fetch('https://authreturn.com/api/apps/score-sing/cognito',{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error(`Auth configuration failed: ${response.status}`);
const config=await response.json();
if(!config.clientId||!config.userPoolId||!config.region)throw Error('Incomplete auth configuration');
const verify=verifier(config),observations=createVerificationStore(),database=createDatabase();
const library=createLibraryHandler({verify,store:createLibraryStore(database)});
const catalog=createCatalog(),catalogRoutes=createCatalogHandler({verify,catalog}),exportRoutes=createExportHandler();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(req.url==='/api/health')return json(200,{status:'ok',version,library:await database.health(),catalog:catalog.health()});
 const pathname=new URL(req.url,'http://localhost').pathname;
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
server.requestTimeout=60000;server.headersTimeout=10000;server.listen(Number(process.env.PORT),'127.0.0.1');
