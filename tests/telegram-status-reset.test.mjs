import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../hosted-snapshot/telegram-ui.js',import.meta.url),'utf8');
test('Changing orders clears the previous status before network response and rejects stale requests',async()=>{
 const field={value:'A'},label={textContent:'',isConnected:true},pending=[];
 const code=source.slice(source.indexOf("  let lastOrderId = '';"),source.indexOf('  function mount()'));
 const refresh=vm.runInNewContext(code+';refreshStatus',{$:s=>s==='#f_orderId'?field:label,window:{MasterAICloud:{profile:{}}},call:()=>new Promise(resolve=>pending.push(resolve))});
 const first=refresh();pending.shift()({state:'pending'});await first;
 assert.match(label.textContent,/Ожидает/);
 field.value='B';const second=refresh();assert.equal(label.textContent,'','old pending label disappears immediately');
 field.value='A';const third=refresh();assert.equal(label.textContent,'');
 pending[1]({state:'accepted'});await third;assert.match(label.textContent,/принял/);
 pending[0]({state:'declined'});await second;assert.match(label.textContent,/принял/);
 field.value='';await refresh();assert.equal(label.textContent,'','unsaved empty ID has no inherited status');
 const count=pending.length;await refresh('B');assert.equal(pending.length,count,'stale send callback cannot fetch unrelated order');
});
