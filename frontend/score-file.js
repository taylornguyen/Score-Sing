const MAX_SCORE=5_000_000,MAX_ARCHIVE_TOTAL=10_000_000,MAX_ENTRIES=128;
function safePath(name){return typeof name==='string'&&name.length>0&&name.length<=512&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes('\0')&&!/^[a-z]+:/i.test(name)&&!name.split('/').some(x=>x==='..'||x==='.');}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function inventory(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true);
 let end=bytes.length-22;
 for(;end>=Math.max(0,bytes.length-65557);end--)if(u32(end)===0x06054b50&&end+22+u16(end+20)===bytes.length)break;
 if(end<0||u32(end)!==0x06054b50)throw Error('ZIP end record is missing');
 const count=u16(end+10),directorySize=u32(end+12),directory=u32(end+16);
 if(u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==count||directory+directorySize!==end)throw Error('Multipart or ZIP64 score archives are unsupported');
 if(count>MAX_ENTRIES)throw Error('Compressed score expands beyond the supported size');
 const entries=new Map();let offset=directory,total=0;
 for(let i=0;i<count;i++){
  if(offset+46>end||u32(offset)!==0x02014b50)throw Error('ZIP directory is damaged');
  const flags=u16(offset+8),method=u16(offset+10),crc=u32(offset+16),size=u32(offset+20),originalSize=u32(offset+24),nameSize=u16(offset+28),extra=u16(offset+30),comment=u16(offset+32),local=u32(offset+42);
  const next=offset+46+nameSize+extra+comment;
  if(next>end||flags&0x41||![0,8].includes(method))throw Error('Encrypted or unsupported score archive');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset+46,offset+46+nameSize));
  if(!safePath(name)||entries.has(name))throw Error('Compressed score contains an invalid or duplicate file path');
  total+=originalSize;
  if(total>MAX_ARCHIVE_TOTAL||originalSize>MAX_SCORE)throw Error('Compressed score expands beyond the supported size');
  if(local+30>directory||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)throw Error('ZIP local metadata is inconsistent');
  const localNameSize=u16(local+26),localExtra=u16(local+28),start=local+30+localNameSize+localExtra;
  const localName=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(local+30,local+30+localNameSize));
  if(localName!==name||start+size>directory||(!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==size||u32(local+22)!==originalSize)))throw Error('ZIP local metadata is inconsistent');
  entries.set(name,{method,crc,size,originalSize,start});offset=next;
 }
 if(offset!==end)throw Error('ZIP directory size is inconsistent');
 return entries;
}
export async function inspectScoreArchive(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_SCORE)throw Error('Choose a compressed score under 5 MB');
 const {Inflate}=await import('./vendor/fflate.js');
 let entries;
 try{entries=inventory(bytes);}catch(error){if(/supported size|file path/.test(error.message))throw error;throw Error('The compressed MusicXML file is damaged or unsupported');}
 function extract(name){
  if(!safePath(name)||name.endsWith('/')||!entries.has(name))throw Error('The score file named by the MusicXML manifest is missing or invalid');
  const entry=entries.get(name),parts=[];let actual=0,crc=0xffffffff;
  const receive=part=>{
   actual+=part.length;
   if(actual>MAX_SCORE||actual>entry.originalSize)throw Error('Compressed score decoded size exceeds its declared or supported size');
   for(const byte of part)crc=crcTable[(crc^byte)&255]^(crc>>>8);
   parts.push(part.slice());
  };
  try{
   if(entry.method===0)receive(bytes.subarray(entry.start,entry.start+entry.size));
   else{
    const inflate=new Inflate(receive),end=entry.start+entry.size;
    // Bounded input chunks let us count real output before processing more compressed data.
    for(let at=entry.start;at<end;at+=1024)inflate.push(bytes.subarray(at,Math.min(at+1024,end)),at+1024>=end);
   }
   if(actual!==entry.originalSize||((crc^0xffffffff)>>>0)!==entry.crc)throw Error('Compressed score size or checksum does not match its contents');
  }catch(error){if(/decoded size|checksum/.test(error.message))throw error;throw Error('The compressed MusicXML score could not be read');}
  const score=new Uint8Array(actual);let at=0;for(const part of parts){score.set(part,at);at+=part.length;}return score;
 }
 if(!entries.has('META-INF/container.xml'))throw Error('Compressed MusicXML is missing META-INF/container.xml');
 if(entries.get('META-INF/container.xml').originalSize>64000)throw Error('The compressed score manifest is too large');
 return {manifest:extract('META-INF/container.xml'),extract};
}
function scorePath(manifestBytes){
 const manifest=new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes);
 if(/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(manifest))throw Error('The compressed score manifest contains unsupported entities');
 const doc=new DOMParser().parseFromString(manifest.replace(/<!DOCTYPE[^>]*>/gi,''),'application/xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='container')throw Error('The compressed score manifest is invalid');
 const roots=[...doc.documentElement.children].find(el=>el.localName==='rootfiles');
 const root=roots&&[...roots.children].find(el=>el.localName==='rootfile');
 if(!root)throw Error('The compressed score manifest does not name a MusicXML score');
 return root.getAttribute('full-path');
}
export async function readScoreFile(file){
 if(file.size>MAX_SCORE)throw Error('Choose a score under 5 MB');
 if(!file.name.toLowerCase().endsWith('.mxl'))return file.text();
 const bytes=await file.arrayBuffer();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./score-archive-worker.js',import.meta.url),{type:'module'});
  const finish=(error,score)=>{clearTimeout(deadline);worker.terminate();error?reject(error):resolve(score);};
  const deadline=setTimeout(()=>finish(Error('Compressed score reading timed out. The previous score was kept.')),15000);
  worker.onerror=event=>{event.preventDefault();finish(Error('Compressed score reader could not start. Reload and try again.'));};
  worker.onmessage=event=>{
   try{
    if(event.data.error)throw Error(event.data.error);
    if(event.data.manifest)worker.postMessage({operation:'extract',path:scorePath(event.data.manifest)});
    else if(event.data.score)finish(null,new TextDecoder('utf-8',{fatal:true}).decode(event.data.score));
    else throw Error('Compressed score reader returned an invalid result');
   }catch(error){finish(error);}
  };
  worker.postMessage({operation:'inspect',bytes},[bytes]);
 });
}
