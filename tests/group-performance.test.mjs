import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
for(const role of ['index','master','dispatcher-logistic'])test(`${role}: grouping preserves aggregates and caches only within each call`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${role}.html`,import.meta.url),'utf8');
 const source=html.match(/^function group\(.*$/m)[0];
 const baseline=source.replace('const m=new Map(),canonicalIds=new Map();','const m=new Map();').replace("let id=canonicalIds.get(raw);if(id===undefined){id=","const id=").replace('canonicalIds.set(raw,id)}','');
 let calls=0;const clean=x=>String(x??'').trim(),canonical=x=>{calls++;return clean(x).toLowerCase()};
 const ctx={$:()=>({value:'callDate'}),today:()=> '2026-11-03',parseDate:v=>v?new Date(v+'T00:00:00Z'):null,iso:d=>d?d.toISOString().slice(0,10):'',derivedStage:()=> 'Выполнен',shiftCashRecordedDate:r=>r.closeDate||'',orderDispatcherName:r=>r.dispatcher,clean,norm:canonical,canonicalKey:x=>clean(x).toLowerCase(),canonicalMasterSelection:canonical,canonicalDispatcherSelection:canonical,num:x=>Number(x)||0,numMaybe:x=>x==null?null:Number(x),truthReview:x=>!!x};
 const f=fs.readFileSync(new URL('../src/crm/finance/shared.js',import.meta.url),'utf8'),ast=parse(f,{ecmaVersion:'latest'});vm.runInNewContext(['collectRecordedCash','analyticsCashCents'].map(name=>{const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return f.slice(n.start,n.end)}).join('\n'),ctx);
 const run=s=>vm.runInNewContext(s+';group',ctx),group=run(source),oldGroup=run(baseline);
 const rows=Array.from({length:1500},(_,i)=>({orderId:String(i),callDate:'2026-10-01',master:[' Иван ','ИВАН','Пётр'][i%3],dispatcher:[' Сергей ','СЕРГЕЙ','Артём'][i%3],total:i%4?5000:0,companyShare:1000,masterAmount:2500,parts:500,cleanCheck:4500,review:i%2,_schemeKnown:true,_fixedMaster:!!(i%2)}));
 const snapshot=JSON.stringify(rows);
 for(const key of ['master','dispatcher']){
  const expected=JSON.stringify(oldGroup(rows,key,r=>r.companyShare));calls=0;
  assert.equal(JSON.stringify(group(rows,key,r=>r.companyShare)),expected);assert.equal(calls,3);
  calls=0;group(rows,key);assert.equal(calls,3,'each render recomputes current name mapping');
 }
 assert.equal(JSON.stringify(rows),snapshot);
});
