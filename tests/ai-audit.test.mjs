import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files=['index','master','dispatcher-logistic'];
function harness(name){
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${name}.html`,import.meta.url),'utf8');
 const names=['aiEligibleMasters','aiFeaturesForMaster','aiOrderRecency',...(name==='index'?['aiCashDay','aiIsCashClosed']:[])];
 const code=names.map(n=>html.split('\n').find(l=>l.startsWith(`function ${n}(`))).join('\n');
 const state={orders:[],settings:{staff:[]}};
 const ctx={state,masterNames:()=>['Сергей','Артём'],canonicalKey:s=>String(s||'').toLowerCase(),num:x=>Number(x)||0,sum:(a,f)=>a.reduce((s,x)=>s+f(x),0),derivedStage:r=>r.status,parseDate:s=>s?new Date(s):null,iso:d=>d?d.toISOString().slice(0,10):'',shiftCashRecordedDate:r=>r.closeDate||'',payrollOrderCashRecorded:r=>r.companyShare>0,median:()=>100,truthReview:()=>false};
 return {state,...vm.runInNewContext(code+';({'+names.join(',')+'})',ctx)};
}
test('AI cash excludes open orders, missing dates and nonpositive cash',()=>{
 const h=harness('index');const rows=[{status:'Выполнен',companyShare:4200,closeDate:'2026-10-31'},{status:'В работе',companyShare:10000,closeDate:'2026-10-31'},{status:'Выполнен',companyShare:900},{status:'Выполнен',companyShare:0,closeDate:'2026-10-31'}];
 assert.equal(rows.filter(h.aiIsCashClosed).reduce((s,r)=>s+r.companyShare,0),4200);
});
for(const name of files)test(`${name}: inactive masters excluded, newest orders first, no fictitious similarity`,()=>{
 const h=harness(name);h.state.settings.staff=[{role:'master',name:'Артём',active:false}];
 assert.deepEqual(Array.from(h.aiEligibleMasters()),['Сергей']);
 const rows=[{callDate:'2025-01-01'},{callDate:'2026-10-31'},{callDate:'2026-10-30'}];
 rows.sort((a,b)=>h.aiOrderRecency(b).localeCompare(h.aiOrderRecency(a)));assert.equal(rows[0].callDate,'2026-10-31');
 h.state.orders=[{master:'Сергей',total:10000,companyShare:5000,city:'Москва',direction:'ПК',status:'Выполнен'}];
 const x=h.aiFeaturesForMaster('Сергей',{city:'СПБ',direction:'ТВ'});assert.equal(x.similar,0);if(name!=='index')assert.equal(x.confidence,0);
});
