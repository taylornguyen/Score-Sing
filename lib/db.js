import fs from 'node:fs/promises';
import pg from 'pg';
export class StorageUnavailable extends Error{}
export const defaultSecretPath='/opt/secrets/score-sing.json';
const keys=['host','port','database','user','password'];
// The mounted service secret is the only connection source: no URL, environment or file-database fallback.
export function databaseConfig(text){
 let secret;try{secret=JSON.parse(text);}catch{throw new StorageUnavailable('Score library database secret is not valid JSON');}
 if(!secret||typeof secret!=='object'||Array.isArray(secret)||Object.keys(secret).some(k=>!keys.includes(k)))throw new StorageUnavailable('Score library database secret has unexpected fields');
 const {host,port=5432,database,user,password}=secret;
 if(typeof host!=='string'||!host||typeof database!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(database)||typeof user!=='string'||!user||(password!==undefined&&(typeof password!=='string'||!password))||!Number.isInteger(port)||port<1||port>65535)
  throw new StorageUnavailable('Score library database secret is incomplete');
 return {host,port,database,user,...(password?{password}:{})};
}
export const schema=`
CREATE TABLE IF NOT EXISTS library_scores(
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
 id uuid NOT NULL,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 track_id text CHECK (track_id ~ '^[A-Za-z0-9]{22}$'),
 musicxml text NOT NULL,
 alignment jsonb NOT NULL DEFAULT '{}'::jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 bytes integer NOT NULL CHECK (bytes > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subject, id)
);
CREATE INDEX IF NOT EXISTS library_scores_recent ON library_scores(subject, updated_at DESC);
CREATE INDEX IF NOT EXISTS library_scores_track ON library_scores(subject, track_id, updated_at DESC) WHERE track_id IS NOT NULL;`;
export function createDatabase({secretPath=defaultSecretPath,read=fs.readFile,Pool=pg.Pool}={}){
 let ready=null;
 function pool(){
  if(!ready){
   ready=(async()=>{
    let text;try{text=await read(secretPath,'utf8');}catch{throw new StorageUnavailable('Score library database secret is not mounted');}
    const p=new Pool({...databaseConfig(text),max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000,query_timeout:8000,lock_timeout:3000,idle_in_transaction_session_timeout:10000,application_name:'score-sing'});
    p.on('error',()=>{});
    try{await p.query(schema);}catch(error){await p.end().catch(()=>{});throw new StorageUnavailable(`Score library database is unavailable: ${error.code||error.message}`);}
    return p;
   })();
   // A failed connection is retried by the next request instead of latching the outage.
   ready.catch(()=>{ready=null;});
  }
  return ready;
 }
 async function transaction(work){
  const client=await (await pool()).connect();
  try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }
 return {
  pool,transaction,
  async query(text,values){return (await pool()).query(text,values);},
  async health(){
   let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),3000);});
   try{await Promise.race([pool().then(p=>p.query('SELECT 1')),deadline]);return 'ok';}catch{return 'unavailable';}finally{clearTimeout(timer);}
  },
  async close(){if(ready){const p=await ready.catch(()=>null);ready=null;await p?.end();}}
 };
}
