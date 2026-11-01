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
for(const page of ['index','master','dispatcher-logistic'])test(`${page}: performance combines equivalent profiles, exposes logins and counts both assignees once`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8');
 const helper=html.match(/^function performanceStaffGroups\(staff\).*$/m)[0];
 const start=html.indexOf('function renderTeamPerformance('),end=html.indexOf('\nfunction ',start+10),render=html.slice(start,end);
 const staff=[{id:'artem',name:'Артём',login:'artem',role:'dispatcher_logistic',shift:'artem'},{id:'tematop',name:'Артем',login:'tematop',role:'dispatcher_logistic',shift:'artem'},{id:'s',name:'Сергей',login:'seregatop',role:'dispatcher_logistic',shift:'sergey'},{id:'other',name:'Другой сотрудник',login:'other',role:'dispatcher_logistic',shift:'artem'}];
 const rows=[{orderId:'A',dispatcher:'artem',_assignedBy:'artem'},{orderId:'B',dispatcher:'artem',_assignedBy:'tematop'}];
 const nodes={staffPerf:{innerHTML:''}},norm=v=>String(v||'').toLowerCase().replace(/ё/g,'е');
 const ctx={state:{settings:{staff}},norm,clean:v=>String(v||'').trim(),payrollShiftKey:r=>r.shift||({'артем':'artem','сергей':'sergey'}[norm(r.approvedForName)]||''),num:Number,$:s=>nodes[s.slice(1)]||null,$$:()=>[],filterRows:()=>rows,orderMatchesDispatcher:(r,p)=>r.dispatcher===p.shift,derivedStage:()=> 'В работе',isServiceMaster:()=>false,minutesBetween:()=>null,median:()=>0,sum:(rs,f)=>rs.reduce((a,r)=>a+f(r),0),orderPayrollShift:r=>r.dispatcher,shiftName:x=>x,esc:v=>String(v),pct:v=>String(v),money:v=>String(v),roleLabel:x=>x};
 vm.runInNewContext(helper+';'+render+';globalThis.groups=performanceStaffGroups(state.settings.staff);renderTeamPerformance()',ctx);
 assert.equal(ctx.groups.length,3);assert.deepEqual(Array.from(ctx.groups[0]._memberIds),['artem','tematop']);
 const table=nodes.staffPerf.innerHTML;assert.equal((table.match(/data-staff-drill=/g)||[]).length,3);assert.ok(table.includes('artem · tematop'));assert.ok(table.includes('seregatop'));assert.match(table,/data-staff-drill="artem"[^]*?<td class="num">2<\/td><td class="num">2<\/td>/);
});
for(const page of ['index','master','dispatcher-logistic'])test(`${page}: fresh master schedule navigation renders employee performance without visiting another tab`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8'),refresh=html.match(/^function refresh\(\).*$/m)[0];
 const calls=[],rows=[{orderId:'CURRENT'}],ctx={$:()=>({dataset:{tab:'mastershifts'}}),filterRows:()=>rows,console};
 for(const name of ['refreshLiveQuality','refillFilters','renderDrillBanner','renderOrders','renderDashboard','renderPerformance','renderShiftClose','renderPayrollCycleRegister','renderMasterShifts','renderShiftReports','renderQuality','renderAI','renderFinance','renderSettings','renderSchema','renderColorAudit'])ctx[name]=()=>calls.push(name);
 ctx.renderTeamPerformance=actual=>{assert.equal(actual,rows);calls.push('renderTeamPerformance')};
 vm.runInNewContext(refresh+';refresh()',ctx);assert.ok(calls.includes('renderMasterShifts'));assert.ok(calls.includes('renderTeamPerformance'));assert.ok(!calls.includes('renderPerformance'));
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');assert.ok(markup.includes('id="staffPerf"'));assert.ok(markup.includes('id="shiftSummary"'));
});
