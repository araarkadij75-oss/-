import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayServer} from '../b2bhelp-gateway/server.mjs';
import {b2bhelp,pageParam,positiveId,safeId,safeText,B2BHELP_API_ORIGIN} from '../b2bhelp-gateway/api/_lib.mjs';

test('B2BHelp request uses the documented host and raw API token header',async t=>{
  const previous=process.env.B2BHELP_API_TOKEN;
  process.env.B2BHELP_API_TOKEN='unit-test-token';
  t.after(()=>previous===undefined?delete process.env.B2BHELP_API_TOKEN:process.env.B2BHELP_API_TOKEN=previous);
  let captured;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    captured={url:new URL(url),options};
    return new Response(JSON.stringify({status:true,result:{messages:[]}}),{status:200,headers:{'content-type':'application/json'}});
  });
  const result=await b2bhelp('/msg-center/chat/messages',{query:{chat_id:'chat-1',account_id:7,page:1,limit:50}});
  assert.deepEqual(result,{messages:[]});
  assert.equal(captured.url.origin,B2BHELP_API_ORIGIN);
  assert.equal(captured.url.pathname,'/msg-center/chat/messages');
  assert.equal(captured.url.searchParams.get('chat_id'),'chat-1');
  assert.equal(captured.options.headers.Authorization,'unit-test-token');
  assert.doesNotMatch(captured.options.headers.Authorization,/^Bearer\s/);
});

test('B2BHelp API calls cannot be made without a server token or to another host',async t=>{
  const previous=process.env.B2BHELP_API_TOKEN;
  delete process.env.B2BHELP_API_TOKEN;
  t.after(()=>previous===undefined?delete process.env.B2BHELP_API_TOKEN:process.env.B2BHELP_API_TOKEN=previous);
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}')});
  await assert.rejects(b2bhelp('/msg-center/chats'),{status:503});
  assert.equal(calls,0);
  process.env.B2BHELP_API_TOKEN='unit-test-token';
  await assert.rejects(b2bhelp('https://example.com/steal'),TypeError);
  assert.equal(calls,0);
});

test('gateway validates pagination, IDs, and exact message length without truncation',()=>{
  assert.equal(pageParam('2',1,1000),2);
  assert.equal(pageParam('2x',1,1000),1);
  assert.equal(pageParam('-4',1,1000),1);
  assert.equal(pageParam('500',1,50),50);
  assert.equal(positiveId('42'),42);
  assert.equal(positiveId('4.2'),null);
  assert.equal(safeId('chat/part'), 'chat/part');
  assert.equal(safeId('bad\nvalue'),'');
  assert.equal(safeText('hello',1000),'hello');
  assert.equal(safeText('x'.repeat(1001),1000),'');
});

test('standalone HTTP server exposes only gateway routes and rejects anonymous chat access',async t=>{
  const server=createGatewayServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const missing=await fetch(`${origin}/api/nope`);
  assert.equal(missing.status,404);
  const anonymous=await fetch(`${origin}/api/chats`,{headers:{origin:'https://araarkadij75-oss.github.io'}});
  assert.equal(anonymous.status,401);
  assert.equal(anonymous.headers.get('cache-control'),'no-store');
  assert.match(await anonymous.text(),/"error":"auth"/);
  const forbidden=await fetch(`${origin}/api/chats`,{headers:{origin:'https://example.com'}});
  assert.equal(forbidden.status,403);
});
