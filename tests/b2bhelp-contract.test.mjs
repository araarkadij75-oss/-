import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('B2BHelp gateway uses only the documented B2BHelp API host',()=>{
  const readme=read('b2bhelp-gateway/README.md');
  const lib=read('b2bhelp-gateway/api/_lib.mjs');
  assert.match(readme,/MASTER AI -> B2BHelp -> Avito/);
  assert.match(readme,/must never send requests to Avito/i);
  assert.match(lib,/https:\/\/dev\.b2b-help\.ru/);
  assert.doesNotMatch(lib,/api\.avito\.ru|AVITO_CLIENT_ID|AVITO_CLIENT_SECRET/);
  assert.match(lib,/Authorization:process\.env\.B2BHELP_API_TOKEN/);
});

test('B2BHelp secret is server-only and never hard-coded',()=>{
  const lib=read('b2bhelp-gateway/api/_lib.mjs');
  const health=read('b2bhelp-gateway/api/health.mjs');
  assert.match(lib,/process\.env\.B2BHELP_API_TOKEN/);
  assert.doesNotMatch(lib+health,/59aadd42b7/i);
  for(const file of ['cloud-config.js','index.html','dispatcher-logistic.html','master.html','sw.js']){
    assert.doesNotMatch(read(file),/B2BHELP_API_TOKEN|59aadd42b7/i,file+' must not contain the B2BHelp secret');
  }
});

test('gateway preserves MASTER AI account role authorization',()=>{
  const lib=read('b2bhelp-gateway/api/_lib.mjs');
  assert.match(lib,/accounts:lookup/);
  assert.match(lib,/master-ai-beta-9440599/);
  assert.match(lib,/master-ai-beta/);
  assert.match(lib,/owner','dispatcher_logistic/);
});

test('documented B2BHelp scopes are least privilege',()=>{
  const readme=read('b2bhelp-gateway/README.md');
  const required=[
    'msg-center.get_accounts',
    'msg-center.get_chats',
    'msg-center.get_chat_messages',
    'msg-center.read_chat',
    'msg-center.send_message'
  ];
  for(const scope of required)assert.match(readme,new RegExp(scope.replaceAll('.','\\.')));
  assert.doesNotMatch(readme,/msg-center\.(delete_chat_message|subscribe_webhook|unsubscribe_webhook|send_message_file)/);
  assert.doesNotMatch(readme,/msg-center\.enable_account/);
  assert.doesNotMatch(readme,/msg-center\.disable_account/);
});

test('deployed legacy gateway contains no direct Avito endpoints or credentials',()=>{
  const apiFiles=['_lib.mjs','pull.mjs','messages.mjs','send.mjs'].map(f=>read('avito-gateway/api/'+f)).join('\n');
  assert.doesNotMatch(apiFiles,/api\.avito\.ru|AVITO_CLIENT_ID|AVITO_CLIENT_SECRET/);
  assert.match(apiFiles,/b2bhelp-gateway/);
  for(const file of ['index.html','dispatcher-logistic.html','master.html','sw.js']){
    assert.doesNotMatch(read(file),/avito-crm-v1\.js/);
  }
});

test('B2BHelp gateway exposes only owner/logistics-safe documented handlers',()=>{
  for(const file of ['accounts.mjs','chats.mjs','messages.mjs','read.mjs','send.mjs']){
    const source=read('b2bhelp-gateway/api/'+file);
    assert.match(source,/authorize\(req,res,\['owner','dispatcher_logistic'\]\)/,file);
    assert.match(source,/b2bhelp\(/,file);
  }
  assert.match(read('b2bhelp-gateway/api/send.mjs'),/safeText\(req\.body\?\.text,1000\)/);
});

test('current Vercel root can resolve each B2BHelp-only route',async()=>{
  for(const file of ['health','accounts','chats','messages','read','send','pull']){
    const route=await import(`../avito-gateway/api/${file}.mjs`);
    assert.equal(typeof route.default,'function',file);
  }
});
