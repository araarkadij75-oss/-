import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
const code=['finance/shared.js','analytics/shared.js','orders/shared.js'].map(p=>fs.readFileSync(new URL('../src/crm/'+p,import.meta.url),'utf8')).join('\n');
const names=['collectRecordedCash','analyticsCashCents','hasRecordedCashSurrenderOn','kpiData','group','orderDate','matchesDrill','renderDashboard','handleKpiDrill','financeMetric'];
const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'});
const source=names.map(name=>{const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return code.slice(n.start,n.end)}).join('\n');
function harness(basis='callDate'){
 const context={$:id=>({value:id==='#dateBasis'?basis:'',checked:false}),today:()=> '2026-11-03',parseDate:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return null;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?d:null},iso:d=>d?d.toISOString().slice(0,10):'',derivedStage:r=>r.stage||'Выполнен',shiftCashRecordedDate:r=>r.closeDate||r._cashClosedOn||'',numMaybe:v=>v==null||v===''?null:Number(v),num:v=>Number(v)||0,sum:(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0),median:()=>0,currentExpenses:()=>[],truthReview:()=>false,isServiceMaster:()=>false,clean:v=>String(v??'').trim(),norm:v=>String(v??'').toLowerCase(),canonicalKey:v=>v,canonicalMasterSelection:v=>v,canonicalDispatcherSelection:v=>v,orderDispatcherName:r=>r.dispatcher,state:{drill:{type:'cash'}}};
 vm.runInNewContext(source,context);return context;
}
const fixture=()=>[
 {orderId:'a',callDate:'2026-10-01',closeDate:'2026-11-01',companyShare:'100.10',total:'',master:'M'},
 {orderId:'b',callDate:'2026-10-02',closeDate:'',companyShare:'200.20',total:300,master:'M'},
 {orderId:'a',callDate:'2026-10-01',closeDate:'2026-11-01',companyShare:999,total:999,master:'M'},
 {orderId:'linked',_duplicateOf:'a',callDate:'2026-10-01',companyShare:999,total:999},
 {orderId:'future',callDate:'2026-10-01',closeDate:'2026-11-04',companyShare:999,total:999},
 {orderId:'reverse',callDate:'2026-10-02',closeDate:'2026-10-01',companyShare:999,total:999},
 {orderId:'bad',callDate:'2026-10-01',closeDate:'invalid',companyShare:999,total:999},
 {orderId:'open',stage:'В работе',callDate:'2026-10-01',companyShare:999,total:999},
 {orderId:'negative',callDate:'2026-10-01',companyShare:-10,total:999},
 {orderId:'flag',stage:'В работе',_cashClosedOn:'2026-11-02',callDate:'2026-10-03',companyShare:10.01,total:0,master:'M'}
];
test('shared cash eligibility accepts late and undated intake receipts, flags, cents, but rejects pending/future/bad/duplicate cash',()=>{
 const h=harness(),rows=fixture(),before=JSON.stringify(rows),entries=h.collectRecordedCash(rows);
 assert.deepEqual(Array.from(entries,x=>x.id),['a','b','flag']);assert.equal(h.analyticsCashCents(rows),31031);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(Array.from(h.collectRecordedCash(rows,{basis:'closeDate'}),x=>x.id),['a','flag']);
 assert.equal(h.hasRecordedCashSurrenderOn(rows[0],'2026-11-01'),true);assert.equal(h.hasRecordedCashSurrenderOn(rows[4],'2026-11-04'),false);
});
test('cash KPI, grouped cash and drill use the same eligibility without requiring a positive total',()=>{
 const h=harness(),rows=fixture();assert.equal(h.kpiData(rows).share,310.31);assert.equal(h.group(rows,'master').reduce((n,x)=>Math.round(n+x.share*100),0),31031);
 assert.equal(h.kpiData(rows).avgShare,310.31/3);assert.equal(h.financeMetric(h.group(rows,'master').find(g=>g.key==='M'),'avgShare'),310.31/3);
 assert.equal(h.matchesDrill(rows[0]),true);assert.equal(h.matchesDrill(rows[4]),false);assert.equal(h.matchesDrill(rows[7]),false);
});
test('non-date surrender note is undated confirmed intake cash, not a made-up cash receipt',()=>{
 const h=harness(),row={orderId:'note',callDate:'2026-10-01',closeDate:'через 5 дней возможно доработка',companyShare:500};h.shiftCashRecordedDate=()=>'';
 assert.equal(h.collectRecordedCash([row]).length,1);assert.equal(h.collectRecordedCash([row],{basis:'closeDate'}).length,0);
});
test('actual dashboard trend equals cash KPI and groups instead of summing open, future or duplicate values',()=>{
 const h=harness(),rows=fixture(),nodes={};let series,flow;
 Object.assign(h,{$:id=>nodes[id]||(nodes[id]={value:id==='#dateBasis'?'callDate':'',innerHTML:''}),$$:()=>[],filterRows:()=>rows,STATUS_ORDER:[],currentUser:()=>({role:'owner'}),kpiCard:()=>'',integer:String,money:String,pct:String,renderExecutiveSummary(){},lineSVG:s=>{series=s;return ''},renderDailyCash(){},barsHTML:rows=>{if(rows.some(r=>r.key==='Касса / сдача'))flow=rows;return ''},periodKey:d=>d.toISOString().slice(0,10),spbArea:r=>r.city,bindBarsToFilter(){},renderDrillBanner(){}});
 h.renderDashboard();assert.equal(Math.round(series[1].values.reduce((n,x)=>n+x.v,0)*100),31031);assert.equal(flow.find(x=>x.key==='Касса / сдача').value,310.31);assert.ok(!flow.some(x=>/Расходы|зарплат/.test(x.key)));
});
test('profit link carries selected period and basis then refreshes without silently carrying staff filters',()=>{
 const h=harness(),nodes={'#dateBasis':{value:'closeDate'},'#fromDate':{value:'2026-10-01'},'#toDate':{value:'2026-10-31'},'#profitFrom':{},'#profitTo':{},'#profitBasis':{},'#dispFilter':{value:'Сергей'}};const calls=[];
 nodes['#profitRefresh']={click:()=>calls.push('refresh')};Object.assign(h,{$:id=>nodes[id],roleVisibleOrders:x=>x,switchTab:tab=>calls.push(tab)});h.state.orders=fixture();h.handleKpiDrill('finance','');
 assert.equal(nodes['#profitFrom'].value,'2026-10-01');assert.equal(nodes['#profitTo'].value,'2026-10-31');assert.equal(nodes['#profitBasis'].value,'cash');assert.deepEqual(calls,['finance','refresh']);assert.equal(nodes['#dispFilter'].value,'Сергей');
});
test('selected date basis is strict and cash basis excludes undated receipts',()=>{
 const h=harness('closeDate');assert.equal(h.analyticsCashCents(fixture()),11011);
 assert.equal(h.orderDate({visitDate:'2026-11-01'},'callDate'),null);
 assert.equal(h.orderDate({callDate:'2026-10-01'},'visitDate'),null);
 assert.equal(h.orderDate({callDate:'2026-10-01'},'closeDate'),null);
 assert.equal(h.orderDate({callDate:'2026-10-01',_cashClosedOn:'2026-11-02'},'closeDate').toISOString().slice(0,10),'2026-11-02');
});
