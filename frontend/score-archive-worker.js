import {inspectScoreArchive} from './score-file.js';
let archive;
self.onmessage=async event=>{
 try{
  if(event.data?.operation==='inspect'){
   archive=await inspectScoreArchive(new Uint8Array(event.data.bytes));
   self.postMessage({manifest:archive.manifest});
  }else if(event.data?.operation==='extract'&&archive){
   const score=archive.extract(event.data.path);self.postMessage({score},[score.buffer]);
  }else throw Error('Compressed score request is invalid');
 }catch(error){self.postMessage({error:error.message||'The compressed score could not be read'});}
};
