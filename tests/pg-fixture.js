// Starts a private, socket-only PostgreSQL cluster with a least-privilege app role for tests.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const bin=['/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin','/usr/lib/postgresql/14/bin'].find(dir=>fs.existsSync(path.join(dir,'initdb')));
export const postgresAvailable=!!bin;
export function startPostgres(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'score-sing-pg-')),socket=path.join(dir,'s'),port=50000+Math.floor(Math.random()*10000);
 fs.mkdirSync(socket);
 const run=(tool,args)=>execFileSync(path.join(bin,tool),args,{stdio:'pipe',timeout:30000});
 run('initdb',['-D',path.join(dir,'data'),'-A','trust','-U','postgres']);
 run('pg_ctl',['-D',path.join(dir,'data'),'-o',`-k ${socket} -c listen_addresses='' -p ${port}`,'-l',path.join(dir,'log'),'-w','-t','20','start']);
 const sql=(command,database='postgres')=>run('psql',['-h',socket,'-p',String(port),'-U','postgres','-d',database,'-Atqc',command]);
 sql("CREATE ROLE app_score_sing LOGIN PASSWORD 'fixture-password' NOSUPERUSER NOCREATEDB NOCREATEROLE");
 sql('CREATE DATABASE score_sing OWNER app_score_sing');
 sql('REVOKE CONNECT ON DATABASE score_sing FROM PUBLIC');
 const secret=path.join(dir,'score-sing.json');
 fs.writeFileSync(secret,JSON.stringify({host:socket,port,database:'score_sing',user:'app_score_sing',password:'fixture-password'}),{mode:0o600});
 return {secret,sql,stop(){try{run('pg_ctl',['-D',path.join(dir,'data'),'-m','immediate','-w','stop']);}finally{fs.rmSync(dir,{recursive:true,force:true});}}};
}
