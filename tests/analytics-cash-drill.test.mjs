import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

for(const role of ['index','dispatcher-logistic','master']){
 const html=fs.readFileSync(new URL('../hosted-snapshot/'+role+'.html',import.meta.url),'utf8');
 test(role+': waiting-for-master drill excludes terminal orders just like its KPI',()=>{
  const source=html.match(/^function matchesDrill\(r\).*$/m)[0];
  const ctx={state:{drill:{type:'unassigned'}},derivedStage:r=>r.status,isServiceMaster:m=>m==='Не назначен'};
  vm.runInNewContext(source,ctx);
  const rows=[{status:'В работе'},{status:'Будущая дата',master:'Не назначен'},{status:'В работе',master:'Мастер'},{status:'Выполнен'},{status:'Отказ'},{status:'Отмена'}];
  assert.deepEqual(rows.map(r=>ctx.matchesDrill(r)),[true,true,false,false,false,false]);
 });
 test(role+': every performance summary button has an effective drill action',()=>{
  const source=html.match(/\$\$\('\[data-scheme-card\]'\)\.forEach\(b=>b.onclick=\(\)=>\{[^]*?\}\);/)[0];
  const buttons=Array.from({length:5},(_,i)=>({dataset:{schemeCard:String(i)}})),calls=[];
  vm.runInNewContext(source,{$$:()=>buttons,applySimpleDrill:(type,label)=>calls.push({type,label}),setDrill:(type,value,label)=>calls.push({type,label})});
  for(const b of buttons)b.onclick();
  assert.deepEqual(calls.map(x=>x.type),['grid','fixed','unknown','review','cash']);
 });
 test(role+': cash details include cash-only rows and corrections, exclude zero and missing cash',()=>{
  const source=html.match(/^function matchesDrill\(r\).*$/m)[0],state={drill:{type:'cash'}};
  const ctx={state,num:v=>Number(v)||0};vm.runInNewContext(source,ctx);
  const rows=[{companyShare:2500,total:null},{companyShare:-500,total:0},{companyShare:0,total:3000},{total:1000}];
  assert.deepEqual(rows.map(r=>ctx.matchesDrill(r)),[true,true,false,false]);
  assert.equal(rows.filter(r=>ctx.matchesDrill(r)).reduce((s,r)=>s+r.companyShare,0),2000);
  assert.match(html,/money\(k\.avgShare\)\+' \/ заказ','cash','green'/);
 });
}
