import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../hosted-snapshot/telegram-ui.js',import.meta.url),'utf8');
function harness(response){
 const notices=[],toast={dataset:{},style:{},setAttribute(k,v){this[k]=v}};
 const context={endpoint:'test-endpoint',$:()=>toast,window:{toast:m=>notices.push(m),MasterAICloud:{connected:true,getIdToken:async()=> 'test-token'}},fetch:async()=>{if(response instanceof Error)throw response;return response}};
 const code=source.slice(source.indexOf('  function telegramErrorMessage'),source.indexOf('  function showDialog'))+source.slice(source.indexOf('  async function setupWebhook'),source.indexOf('  async function pairMaster('));
 return {notices,toast,...vm.runInNewContext(code+';({setupWebhook,telegramErrorMessage,notify})',context)};
}
for(const response of [{ok:false,json:async()=>({ok:false,error:'telegram_network_unreachable'})},{ok:true,json:async()=>({ok:false,error:'telegram_service_unavailable'})},new Error('Failed to fetch')])test('Webhook failure is Russian, red and never success',async()=>{
 const h=harness(response),button={textContent:'Подключить бота'};await h.setupWebhook(button);
 assert.equal(h.notices.length,1);assert.match(h.notices[0],/[а-я]/i);assert.doesNotMatch(h.notices[0],/telegram_|бот подключён/);
 assert.equal(h.toast.dataset.telegramKind,'error');assert.equal(h.toast.style.background,'#991b1b');assert.equal(h.toast.role,'alert');
 assert.equal(button.disabled,false);assert.equal(button.textContent,'Подключить бота');
});
test('Only confirmed API success displays connected and resets error style',async()=>{
 const h=harness({ok:true,json:async()=>({ok:true,botUsername:'test_bot'})});
 h.notify('Ошибка','error');await h.setupWebhook({textContent:'Подключить бота'});
 assert.equal(h.notices[1],'Telegram-бот подключён: @test_bot');assert.equal(h.toast.style.background,'');assert.equal(h.toast.role,'status');
 assert.doesNotMatch(h.telegramErrorMessage(new Error('internal_secret_error')),/internal_secret_error/);
});
