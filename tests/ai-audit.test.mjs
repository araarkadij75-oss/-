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

test('AI attention and risk use rolling scope while history, financial totals and master selection stay intact',()=>{
 const source=fs.readFileSync(new URL('../src/crm/quality/owner.js',import.meta.url),'utf8'),code=source.split('/* CRM_UNIT:renderAI-daf2a699a278 */')[1].split('/* CRM_END:renderAI-daf2a699a278 */')[0];
 const qctx={module:{exports:{}},Date};vm.runInNewContext(fs.readFileSync(new URL('../hosted-snapshot/quality-monitor.js',import.meta.url),'utf8'),qctx);const monitor=qctx.module.exports;let now='2026-11-06T10:00:00Z';
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:''});return nodes.get(id)};
 const rows=[{_id:'old',orderId:'old',callDate:'2026-10-22',_status:'В работе'},{_id:'boundary',orderId:'boundary',callDate:'2026-10-23',_status:'В работе'},{_id:'future',orderId:'future',callDate:'2026-12-01',_status:'В работе'},{_id:'unknown',orderId:'unknown',_status:'В работе'},{_id:'cash-old',callDate:'2026-10-01',_status:'Выполнен',companyShare:100},{_id:'cash-new',callDate:'2026-10-25',_status:'Выполнен',companyShare:200},{_id:'paid-today',callDate:'2026-10-01',closeDate:'2026-11-06',_status:'Выполнен',companyShare:300}];const before=JSON.stringify(rows),state={orders:rows,settings:{}};
 const ctx={state,$,$$:()=>[],window:{MasterAIQualityMonitor:{inScope:r=>monitor.inScope(r,monitor.scopeStartAt(new Date(now)))}},today:()=> '2026-11-06',derivedStage:r=>r._status,parseDate:s=>s?new Date(s):null,iso:d=>d?.toISOString().slice(0,10)||'',aiCashDay:r=>r.closeDate||'',aiIsCashClosed:r=>r._status==='Выполнен'&&r.companyShare>0&&!!r.closeDate,payrollOrderCashRecorded:r=>r.companyShare>0,isServiceMaster:s=>!s,aiOrderRecency:r=>r.callDate||'',integer:String,clean:s=>String(s||'').trim(),esc:String,STATUS_ORDER:['В работе','Выполнен'],statusPill:String,setOrderColorFilter(){},openOrderDetails(){},aiEligibleMasters:()=>[],num:n=>Number(n)||0,money:String,pct:String,sum:(a,f)=>a.reduce((s,r)=>s+f(r),0),barsHTML:JSON.stringify,canonicalKey:String};vm.createContext(ctx);vm.runInContext(code+';globalThis.render=renderAI',ctx);ctx.render();
 assert.match($('#aiAttentionList').innerHTML,/3 без мастера/);assert.doesNotMatch($('#aiAttentionList').innerHTML,/data-ai-open="old"/);assert.match($('#aiOrderSelect').innerHTML,/value="old"/,'Old unassigned order remains available for master selection');
 const risk=JSON.parse($('#aiRiskForecast').innerHTML);assert.equal(risk.find(r=>r.key.includes('Без мастера')).value,3);assert.equal(risk.find(r=>r.key==='Касса без даты').value,1);
 assert.match($('#aiTodayForecast').innerHTML,/>300</,'Old intake cash surrendered today remains included');assert.match($('#aiExtendedForecast').innerHTML,/вся история · 1 заказов/);assert.match($('#aiDataSource').textContent,/7 заказов/);
 now='2026-11-07T10:00:00Z';ctx.render();assert.match($('#aiAttentionList').innerHTML,/2 без мастера/,'Period rolls without changing records');assert.equal(JSON.stringify(rows),before);
});

test('quality drills share the exact rolling scope without restricting ordinary historical drills',()=>{
 const src=fs.readFileSync(new URL('../src/crm/analytics/shared.js',import.meta.url),'utf8'),code=src.split('/* CRM_UNIT:matchesDrill-d5b8a7801f0d */')[1].split('/* CRM_END:matchesDrill-d5b8a7801f0d */')[0],qctx={module:{exports:{}},Date};vm.runInNewContext(fs.readFileSync(new URL('../hosted-snapshot/quality-monitor.js',import.meta.url),'utf8'),qctx);const monitor=qctx.module.exports,scope=monitor.scopeStartAt(new Date('2026-11-06T00:00:00+03:00'));
 const ctx={state:{drill:{type:'quality_unassigned'},settings:{cashSla:24}},window:{MasterAIQualityMonitor:{inScope:r=>monitor.inScope(r,scope)}},derivedStage:r=>r._status,isServiceMaster:s=>!s,num:Number,Date};vm.createContext(ctx);vm.runInContext(code+';globalThis.matches=matchesDrill',ctx);
 const old={callDate:'2026-10-22',_status:'В работе',_createdAt:'2026-01-01',companyShare:100},recent={...old,callDate:'2026-10-23'};
 assert.equal(ctx.matches(old),false);assert.equal(ctx.matches(recent),true);assert.equal(ctx.matches({_status:'В работе'}),true);assert.equal(ctx.matches({...recent,_status:'Отмена'}),false);
 ctx.state.drill.type='unassigned';assert.equal(ctx.matches(old),true,'Historical generic filter stays unchanged');ctx.state.drill.type='quality_cash_overdue';assert.equal(ctx.matches(old),false);assert.equal(ctx.matches(recent),true);
});

test('quality drill clears only stale order-list filters and never inherits historical analytics dates',()=>{
 const src=fs.readFileSync(new URL('../src/crm/analytics/shared.js',import.meta.url),'utf8'),code=src.split('/* CRM_UNIT:setDrill-caaea8c044dd */')[1].split('/* CRM_END:setDrill-caaea8c044dd */')[0];const nodes=new Map();for(const id of ['orderSearch','orderStageFilter','masterWorkflowFilter','fromDate','todayOrdersFilter','tomorrowOrdersFilter'])nodes.set('#'+id,{value:'old-filter',setAttribute(k,v){this[k]=v}});nodes.set('.tab.active',{dataset:{tab:'dashboard'}});const ctx={state:{},$:id=>nodes.get(id),orderPage:3,renderDrillBanner(){},switchTab(){},renderOrders(){}};vm.createContext(ctx);vm.runInContext(code+';setDrill("quality_unassigned","","Контроль")',ctx);assert.equal(ctx.state.drill.analyticsScope,false);assert.equal(nodes.get('#orderSearch').value,'');assert.equal(nodes.get('#orderStageFilter').value,'');assert.equal(nodes.get('#todayOrdersFilter')['aria-pressed'],'false');assert.equal(nodes.get('#fromDate').value,'old-filter');
});
