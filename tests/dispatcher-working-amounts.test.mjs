import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('dispatcher order columns remain aligned without granting general finance access',()=>{
 const html=read('src/crm/ui/screens/dispatcher.html'),js=read('src/crm/orders/dispatcher.js'),meta=read('src/crm/staff/dispatcher.js');
 const head=html.slice(html.indexOf('orders-table-wrap')).match(/<thead><tr>(.*?)<\/tr><\/thead>/s)[1],row=js.match(/return `<tr class="order-status-row(.*?)<\/tr>`/s)[1];
 assert.equal((head.match(/<th(?: |>|\b)/g)||[]).length,17);assert.equal((row.match(/<td(?: |>|\b)/g)||[]).length,17);
 assert.equal((head.match(/order-working-amount/g)||[]).length,3);assert.equal((row.match(/order-working-amount/g)||[]).length,3);
 assert.match(meta,/dispatcher_logistic:\{[^}]*money:false/);assert.doesNotMatch(meta.match(/dispatcher_logistic:\{([^}]*)/)[1],/'finance'|'profit'|'reports'/);
 assert.match(js,/moneyVisible=can\('money'\)\|\|currentRole\(\)==='dispatcher_logistic'/);assert.doesNotMatch(js,/class="[^"\n]*finance-col/);
 for(const key of ['total','masterAmount','companyShare'])assert.match(js,new RegExp('numMaybe\\(r\\.'+key+'\\)'));
});
test('order amount feed preserves canonical values and discards stale-account responses',async()=>{
 const source=read('src/crm/integrations/dispatcher.js'),body=source.slice(source.indexOf('  cloud.subscribeCloseData='),source.indexOf('  cloud.subscribeCloseData=')+source.slice(source.indexOf('  cloud.subscribeCloseData=')).indexOf('\n  };')+6);
 let snap,resolve,results=[],unsub=0;const cloud={connected:true,profile:{id:'s',role:'dispatcher_logistic'},getIdToken:async()=> 'opaque'};
 const fsStub={collection:()=>({}),onSnapshot:(q,cb)=>{snap=cb;return()=>unsub++}};
 const ctx={cloud,fs:fsStub,db:{},ws:'w',window:{},fetch:async()=>new Promise(r=>resolve=r)};vm.runInNewContext(body,ctx);cloud.subscribeCloseData(r=>results.push(r));
 snap({docs:[{id:'o',data:()=>({total:1,closeDate:'2026-11-06'})}]});await new Promise(r=>setImmediate(r));resolve({ok:true,json:async()=>({ok:true,orders:[{orderId:'o',total:12000,masterAmount:6000,companyShare:5000,private:'hidden'}]})});await new Promise(r=>setImmediate(r));
 assert.equal(results.length,1);assert.equal(results[0][0].total,12000);assert.equal(results[0][0].companyShare,5000);assert.equal(results[0][0].closeDate,'2026-11-06');assert.equal(results[0][0].private,undefined);
 cloud.refreshOrderAmounts();await new Promise(r=>setImmediate(r));cloud.profile={id:'a',role:'dispatcher_logistic'};resolve({ok:true,json:async()=>({ok:true,orders:[{orderId:'o',total:999}]})});await new Promise(r=>setImmediate(r));assert.equal(results.length,1);cloud.closeDataUnsub();assert.equal(unsub,1);
});
