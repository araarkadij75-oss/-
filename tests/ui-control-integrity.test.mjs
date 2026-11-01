import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
for(const page of ['index','master','dispatcher-logistic']){
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8');
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<!--[^]*?-->/g,'');
 test(`${page}: static controls have unique IDs and label targets exist`,()=>{
  const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length,'Duplicate IDs route updates and clicks to the wrong control');
  for(const m of markup.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g))assert.ok(ids.includes(m[1]),`Missing labelled control ${m[1]}`);
 });
 test(`${page}: current shift copy uses this employee and today, despite another latest saved report`,async()=>{
  const share=html.match(/^async function shareShiftReport\(r\).*$/m)?.[0];assert.ok(share);
  const handler=html.match(/\$\('#shareShiftBtn'\)\.onclick=(\(\)=>shareShiftReport\([^;]+);/)[1];
  let copied;
  const employee={id:'sergey',name:'Сергей'},date='2026-11-01';
  const ctx={state:{shiftReports:[{date:'2026-10-30',approvedForName:'Артём',cash:900}]},currentUser:()=>employee,today:()=>date,shiftSnapshot:(d,p)=>({date:d,approvedForName:p.name,cash:123}),shiftReportText:r=>JSON.stringify(r),navigator:{clipboard:{writeText:async text=>{copied=JSON.parse(text)}}},toast:()=>{}};
  vm.runInNewContext(share+';globalThis.copyCurrent='+handler,ctx);
  await ctx.copyCurrent();assert.equal(copied.date,date);assert.equal(copied.approvedForName,'Сергей');assert.equal(copied.cash,123);
 });
}

for(const page of ['index','master','dispatcher-logistic'])test(`${page}: clearing import permits selecting the same file again`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8');
 const handler=html.match(/\$\('#clearImport'\)\.onclick=(\(\)=>\{[^]*?\});\$\('#exportCsv'\)/)?.[1];assert.ok(handler);
 const nodes=new Map(['fileInput','mergeImport','clearImport','importStatus','importStats'].map(id=>[id,{value:id==='fileInput'?'C:\\fakepath\\orders.csv':'',disabled:false,className:'',textContent:'',innerHTML:'stats'}]));
 const state={importRows:[{orderId:'test'}],importName:'orders.csv'};let rendered=0;
 const context={state,$:selector=>nodes.get(selector.slice(1)),renderImportPreview:()=>rendered++};
 vm.runInNewContext('('+handler+')()',context);
 assert.equal(nodes.get('fileInput').value,'','Native file input must reset for a same-file change event');
 assert.equal(state.importRows.length,0);assert.equal(state.importName,'');assert.equal(rendered,1);assert.equal(nodes.get('mergeImport').disabled,true);
});
