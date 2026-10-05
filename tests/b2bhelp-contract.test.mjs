import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('B2BHelp gateway is the only future Avito-origin message path',()=>{
  const readme=read('b2bhelp-gateway/README.md');
  const lib=read('b2bhelp-gateway/api/_lib.mjs');
  assert.match(readme,/Avito -> B2BHelp -> MASTER AI/);
  assert.match(readme,/must \*\*not\*\* authenticate to or call Avito directly/i);
  assert.doesNotMatch(lib,/api\.avito\.ru|AVITO_CLIENT_ID|AVITO_CLIENT_SECRET/);
});

test('B2BHelp secret is server-only and never hard-coded',()=>{
  const lib=read('b2bhelp-gateway/api/_lib.mjs');
  const health=read('b2bhelp-gateway/api/health.mjs');
  assert.match(lib,/process\.env\.B2BHELP_API_TOKEN/);
  assert.match(lib,/process\.env\.B2BHELP_API_BASE_URL/);
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
    'msg-center.subscribe_webhook',
    'msg-center.get_chats',
    'msg-center.get_chat_messages',
    'msg-center.read_chat',
    'msg-center.send_message',
    'msg-center.send_message_file',
    'msg-center.unsubscribe_webhook'
  ];
  for(const scope of required)assert.match(readme,new RegExp(scope.replaceAll('.','\\.')));
  assert.doesNotMatch(readme,/msg-center\.delete_chat_message/);
  assert.doesNotMatch(readme,/msg-center\.enable_account/);
  assert.doesNotMatch(readme,/msg-center\.disable_account/);
});

test('legacy direct Avito runtime remains disabled',()=>{
  const oldLib=read('avito-gateway/api/_lib.mjs');
  const oldClient=read('avito-crm-v1.js');
  assert.match(oldLib,/integrationEnabled=\(\)=>false/);
  assert.match(oldClient,/^\(\(\)=>\{\s*\/\/ Avito integration is intentionally disabled[^]*?\sreturn;/);
  for(const file of ['index.html','dispatcher-logistic.html','master.html','sw.js']){
    assert.doesNotMatch(read(file),/avito-crm-v1\.js/);
  }
});
