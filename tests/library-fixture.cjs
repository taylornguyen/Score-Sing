// Browser fixtures: local sign-in stand-in plus the real library handler on a private PostgreSQL cluster.
const http=require('node:http');
// The fixture "token" is the subject itself; the real handler still rejects requests without one.
exports.authScript=subjectExpression=>`window.ScoreSignIn={init(o){window.fixtureAuth=o;document.querySelector(o.showWhenLoggedIn).hidden=false;setTimeout(o.onLogin,0);return {fetchWithAuth:async(url,options={})=>{const subject=${subjectExpression};if(url==='/api/session')return {ok:true,json:async()=>({subject})};return fetch(url,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+subject}});}}}};`;
exports.startLibrary=async()=>{
 const {postgresAvailable,startPostgres}=await import('./pg-fixture.js');
 if(!postgresAvailable)throw Error('Browser library checks need PostgreSQL binaries (initdb) on this machine');
 const {createDatabase}=await import('../lib/db.js'),{createLibraryStore,createLibraryHandler}=await import('../lib/library.js');
 const pg=startPostgres(),db=createDatabase({secretPath:pg.secret}),real=createLibraryStore(db),state={down:false};
 const store=new Proxy(real,{get:(target,key)=>(...args)=>{if(state.down)throw Error('storage down');return target[key](...args);}});
 const handle=createLibraryHandler({verify:async token=>{if(!/^[\w-]+$/.test(token))throw Error('no token');return {sub:token};},store});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res,new URL(req.url,'http://x').pathname)){res.writeHead(404);res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 return {
  state,sql:command=>pg.sql(command,'score_sing').toString().trim(),
  // The song catalog finds nothing unless a test routes its own matches after this.
  route:async target=>{
   await target.route(/^https:\/\/score-sing\.test\/api\/catalog\/match\?/,route=>route.fulfill({json:{candidates:[]}}));
   await target.route(/^https:\/\/score-sing\.test\/api\/library(\/|$|\?)/,async route=>{
    const url=new URL(route.request().url());
    await route.fulfill({response:await route.fetch({url:origin+url.pathname+url.search,timeout:15000})});
   });
  },
  async stop(){await new Promise(resolve=>server.close(resolve));await db.close();pg.stop();}
 };
};
