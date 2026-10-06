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

test('CRM inbox uses the REG.RU gateway with no direct Avito client or Vercel deployment config',()=>{
  const inbox=read('b2bhelp-inbox.js');
  const gateway=read('b2bhelp-gateway/regru/api/index.php');
  const server=read('b2bhelp-gateway/server.mjs');
  assert.match(inbox,/https:\/\/remontcompsbp\.ru\/api/);
  assert.match(gateway,/https:\/\/dev\.b2b-help\.ru/);
  assert.match(server,/\/api\/send/);
  assert.equal(fs.existsSync(new URL('../avito-gateway/vercel.json',import.meta.url)),false);
  assert.equal(fs.existsSync(new URL('../avito-gateway/package.json',import.meta.url)),false);
  assert.equal(fs.existsSync(new URL('../b2bhelp-gateway/vercel.json',import.meta.url)),false);
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
