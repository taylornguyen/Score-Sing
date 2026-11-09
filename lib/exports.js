// Expiring download links for codebase exports: <dir>/<token>/ holds the files plus `expires-at` (ISO time).
// The 64-hex token is the only credential, like a share link; expired or unknown links return 404.
import fs from 'node:fs';
import path from 'node:path';
export const DEFAULT_EXPORT_DIR='/home/ubuntu/.local/share/score-sing/exports';
const TYPES={'.zip':'application/zip','.bundle':'application/octet-stream','.tar':'application/x-tar','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8'};
export function createExportHandler({dir=process.env.SCORE_SING_EXPORT_DIR||DEFAULT_EXPORT_DIR,now=Date.now}={}){
 return async(req,res,pathname)=>{
  const match=/^\/download\/([0-9a-f]{64})\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/.exec(pathname);
  if(!pathname.startsWith('/download/'))return false;
  const missing=()=>{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('This download link is unknown or has expired.');return true;};
  if(!match||!['GET','HEAD'].includes(req.method)||match[2]==='expires-at')return missing();
  const folder=path.join(dir,match[1]),file=path.join(folder,match[2]);
  let expires,stat;
  try{expires=Date.parse(fs.readFileSync(path.join(folder,'expires-at'),'utf8').trim());stat=fs.statSync(file);}catch{return missing();}
  if(!(expires>now())||!stat.isFile())return missing();
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Content-Disposition':`attachment; filename="${match[2]}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD'){res.end();return true;}
  await new Promise(resolve=>{const stream=fs.createReadStream(file);stream.on('error',()=>{res.destroy();resolve();});res.on('close',()=>{stream.destroy();resolve();});stream.pipe(res);});
  return true;
 };
}
