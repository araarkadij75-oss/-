import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../hosted-snapshot/telegram-ui.js',import.meta.url),'utf8');
function harness(response){
 const notices=[],toast={style:{background:'green'}},nodes=new Map(),timers=[];
 const document={createElement:()=>({style:{},setAttribute(k,v){this[k]=v},remove(){nodes.delete(this.id)}}),body:{append:el=>nodes.set(el.id,el)}};
 const context={endpoint:'test-endpoint',document,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout:()=>{},$:s=>s==='#toast'?toast:nodes.get(s.slice(1)),window:{toast:m=>notices.push(m),MasterAICloud:{connected:true,getIdToken:async()=> 'test-token'}},fetch:async()=>{if(response instanceof Error)throw response;return response}};
 const code=source.slice(source.indexOf('  function telegramErrorMessage'),source.indexOf('  function showDialog'))+source.slice(source.indexOf('  async function setupWebhook'),source.indexOf('  async function pairMaster('));
 return {notices,toast,nodes,timers,...vm.runInNewContext(code+';({setupWebhook,telegramErrorMessage,notify})',context)};
}
for(const response of [{ok:false,json:async()=>({ok:false,error:'telegram_network_unreachable'})},{ok:true,json:async()=>({ok:false,error:'telegram_service_unavailable'})},new Error('Failed to fetch')])test('Webhook failure is Russian, red and never success',async()=>{
 const h=harness(response),button={textContent:'Подключить бота'};await h.setupWebhook(button);
 assert.equal(h.notices.length,0);const error=h.nodes.get('telegramErrorToast');assert.match(error.textContent,/[а-я]/i);assert.doesNotMatch(error.textContent,/telegram_|бот подключён/);
 assert.match(error.style.cssText,/#991b1b/);assert.equal(error.role,'alert');assert.equal(h.toast.style.background,'green');assert.equal(h.timers[0].ms,3600);h.timers[0].fn();assert.equal(h.nodes.size,0);
 assert.equal(button.disabled,false);assert.equal(button.textContent,'Подключить бота');
});
test('Only confirmed API success displays connected and resets error style',async()=>{
 const h=harness({ok:true,json:async()=>({ok:true,botUsername:'test_bot'})});
 h.notify('Ошибка','error');await h.setupWebhook({textContent:'Подключить бота'});
 assert.equal(h.notices[0],'Telegram-бот подключён: @test_bot');assert.equal(h.toast.style.background,'green');assert.equal(h.nodes.size,0);
 assert.doesNotMatch(h.telegramErrorMessage(new Error('internal_secret_error')),/internal_secret_error/);
});

test('API diagnostic codes have clear Russian messages',()=>{const h=harness({});for(const code of ['telegram_token_rejected','telegram_invalid_api_response','telegram_api_rejected_request','telegram_webhook_registration_failed']){const message=h.telegramErrorMessage(new Error(code));assert.match(message,/[а-я]/i);assert.doesNotMatch(message,/telegram_|Не удалось выполнить операцию Telegram/);}});
