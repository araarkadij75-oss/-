import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const page of ['index.html','master.html','dispatcher-logistic.html']) {
  const html=fs.readFileSync(new URL('../hosted-snapshot/'+page,import.meta.url),'utf8');
  const start=html.indexOf('function isExcelSerialTime(');
  const end=html.indexOf('function quality()',start);
  const ctx=vm.createContext({clean:v=>String(v??'').trim(),norm:v=>String(v??'').trim().toLowerCase(),cleanPhoneForCompare:v=>String(v??'').replace(/\D/g,''),iso:d=>d?.toISOString().slice(0,10)||'',parseDate:v=>v?new Date(v):null,state:{orders:[]}});
  vm.runInContext(html.slice(start,end),ctx);
  test(page+': ordinary appointment times are not Excel serials',()=>{
    for(const time of ['12:30','12.30','17:00-18:00','вечер','1000','']) assert.equal(ctx.isExcelSerialTime(time),false,time);
    assert.equal(ctx.isExcelSerialTime('45961'),true);
    assert.equal(ctx.isExcelSerialTime(45961.5),true);
  });
  test(page+': duplicates remain detectable after amount or master changes',()=>{
    const row={callDate:'2026-10-31',phone:'89990000000',address:'Улица, 1',request:'Установка Windows'};
    const rows=[{...row,_id:'a',master:'Один',total:0},{...row,_id:'b',master:'Другой',total:5000},{...row,_id:'c',callDate:'2026-11-01'}];
    assert.deepEqual([...ctx.duplicateOrderIds(rows)],['a','b']);
    assert.equal(ctx.duplicateOrderKey({...row,phone:''}),'');
  });
  test(page+': long cash calendars include the newest date',()=>{
    const source=html.slice(html.indexOf('function renderDailyCash('),html.indexOf('\n',html.indexOf('function renderDailyCash(')));
    const elements={'#dailyCash':{innerHTML:''},'#dailyCashPeriod':{textContent:''},'#fromDate':{value:'2025-01-01'},'#toDate':{value:'2026-10-31'}};
    const env=vm.createContext({$:id=>elements[id],orderDate:r=>new Date(r.date),parseDate:v=>v?new Date(v):null,sum:(a,f)=>a.reduce((s,x)=>s+f(x),0),num:Number,money:String,integer:String,fmtDate:String});
    vm.runInContext(source,env);
    env.renderDailyCash([{date:'2026-10-31',total:5000,companyShare:2500}]);
    assert.match(elements['#dailyCash'].innerHTML,/2026-10-31/);
    assert.doesNotMatch(elements['#dailyCash'].innerHTML,/2025-01-01/);
    assert.match(elements['#dailyCashPeriod'].textContent,/Последние 366/);
  });
}
