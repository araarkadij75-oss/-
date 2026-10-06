import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import health from './api/health.mjs';
import accounts from './api/accounts.mjs';
import chats from './api/chats.mjs';
import messages from './api/messages.mjs';
import read from './api/read.mjs';
import send from './api/send.mjs';

const routes=new Map([
  ['/api/health',health],['/api/accounts',accounts],['/api/chats',chats],
  ['/api/pull',chats],['/api/messages',messages],['/api/read',read],['/api/send',send]
]);
const maxBodyBytes=32*1024;

function responseAdapter(res){
  return {
    status(code){res.statusCode=code;return this},
    setHeader(name,value){res.setHeader(name,value)},
    json(data){res.end(JSON.stringify(data));return this},
    end(){res.end();return this}
  };
}

export function createGatewayServer(){return createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  const handler=routes.get(url.pathname);
  if(!handler){res.writeHead(404,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end('{"ok":false,"error":"not_found"}');return}
  const query=Object.fromEntries(url.searchParams.entries());
  let body={};
  if(req.method==='POST'){
    const chunks=[];let size=0;
    try{
      for await(const chunk of req){
        size+=chunk.length;
        if(size>maxBodyBytes){res.writeHead(413,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end('{"ok":false,"error":"body_too_large"}');return}
        chunks.push(chunk);
      }
      const raw=Buffer.concat(chunks).toString('utf8');
      body=raw?JSON.parse(raw):{};
      if(!body||typeof body!=='object'||Array.isArray(body))throw new TypeError('Invalid request body');
    }catch{
      res.writeHead(400,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end('{"ok":false,"error":"invalid_body"}');return
    }
  }
  try{await handler({method:req.method,headers:req.headers,query,body},responseAdapter(res))}
  catch(error){
    if(!res.headersSent){res.writeHead(502,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end('{"ok":false,"error":"gateway"}')}
    console.error('gateway handler failed',url.pathname,String(error?.name||'Error'));
  }
})}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createGatewayServer();
  server.requestTimeout=10_000;
  server.headersTimeout=12_000;
  server.listen(Number(process.env.PORT||8080),process.env.HOST||'0.0.0.0',()=>console.log(`B2BHelp gateway listening on ${server.address().port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
}
