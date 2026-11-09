export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
// Reads one JSON body with a byte limit and a deadline; the request is never left half-read without an answer.
export function readJson(req,{limit,timeout,label='Request'}){
 return new Promise((resolve,reject)=>{
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>limit)return reject(new HttpError(413,`${label} body is too large`));
  let size=0,finished=false;const chunks=[];
  const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(deadline);error?reject(error):resolve(value);};
  const deadline=setTimeout(()=>done(new HttpError(408,`${label} body timed out`)),timeout);
  req.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>limit)return done(new HttpError(413,`${label} body is too large`));chunks.push(chunk);});
  req.on('end',()=>{try{done(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{done(new HttpError(400,`Invalid JSON ${label.toLowerCase()} body`));}});
  req.on('error',error=>done(error));
 });
}
