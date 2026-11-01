import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';

const pages = {owner:'index.html', dispatcher_logistic:'dispatcher-logistic.html', master:'master.html'};
const renderers = ['refillFilters','renderDrillBanner','renderOrders','renderDashboard','renderPerformance',
  'renderShiftClose','renderPayrollCycleRegister','renderMasterShifts','renderTeamPerformance',
  'renderShiftReports','renderQuality','renderAI','renderFinance','renderSettings','renderSchema','renderColorAudit'];

function harness(role, {profitLoaded = false, failing = ''} = {}) {
  const html = fs.readFileSync(new URL('../hosted-snapshot/'+pages[role],import.meta.url),'utf8');
  const script = [...html.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)]
    .map(x=>x[1]).find(x=>x.includes('function switchTab('));
  const ast = parse(script,{sourceType:'module',ecmaVersion:'latest'});
  const selected = ast.body.filter(n => n.type==='FunctionDeclaration'&&['switchTab','refresh'].includes(n.id.name)
    || n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='ROLE_META'));
  const make = (name,key) => ({dataset:{[key]:name},active:name==='orders',classList:{toggle(_class,value){this.owner.active=value;}}});
  const tabs = [...new Set([...html.matchAll(/class="tab(?: active)?" data-tab="([^"]+)"/g)].map(x=>x[1]))].map(x=>make(x,'tab'));
  const panels = [...new Set([...html.matchAll(/data-panel="([^"]+)"/g)].map(x=>x[1]))].map(x=>make(x,'panel'));
  if(profitLoaded){tabs.push(make('profit','tab'));panels.push(make('profit','panel'));}
  for(const el of [...tabs,...panels])el.classList.owner=el;
  const calls = [], errors=[];
  const context = {
    document:{getElementById:id=>id==='profitPanel'&&profitLoaded?{}:null},
    $:selector=>selector==='.tab.active'?tabs.find(x=>x.active):null,
    $$:selector=>selector==='.tab'?tabs:selector==='.section'?panels:[],
    filterRows:()=>[], refreshLiveQuality(){},
    console:{error:(...args)=>errors.push(args)},
  };
  for(const name of renderers)context[name]=()=>{calls.push(name);if(name===failing)throw new Error('Injected '+name)};
  vm.createContext(context);
  vm.runInContext(selected.map(n=>script.slice(n.start,n.end)).join('\n')+'\nglobalThis.allowed=ROLE_META['+JSON.stringify(role)+'].tabs;',context);
  context.roleMeta=()=>({tabs:context.allowed});
  return {calls,errors,tabs,panels,allowed:[...context.allowed], switchTab:context.switchTab};
}

const expected = {
  orders:'renderOrders', dashboard:'renderDashboard', performance:'renderPerformance',
  mastershifts:'renderMasterShifts', shiftclose:'renderShiftClose', payrollcycles:'renderPayrollCycleRegister',
  reports:'renderShiftReports', ai:'renderAI', finance:'renderFinance', quality:'renderQuality',
  diagnostics:'renderColorAudit', import:'renderSchema', settings:'renderSettings',
};

for(const role of Object.keys(pages)) {
  test(role+': every allowed renderer failure stays contained without interrupting navigation',()=>{
    const allowed=harness(role).allowed;
    for(const [route,renderer] of Object.entries(expected)){
      if(!allowed.includes(route))continue;
      const h=harness(role,{failing:renderer});
      assert.doesNotThrow(()=>h.switchTab(route));
      assert.ok(h.errors.length>0,route+': error must be observable');
      const next=allowed.includes('dashboard')&&route==='orders'?'dashboard':'orders';
      const before=h.calls.length;
      assert.doesNotThrow(()=>h.switchTab(next));
      assert.ok(h.calls.slice(before).includes(expected[next]));
    }
    for(const helper of ['refillFilters','renderDrillBanner']){
      const h=harness(role,{failing:helper});h.switchTab('orders');
      assert.ok(h.calls.includes('renderOrders'));assert.ok(h.errors.length>0);
    }
  });
  for(const [route,renderer] of Object.entries(expected)) {
    const h = harness(role);
    if(!h.allowed.includes(route)) continue;
    test(role+': direct navigation to '+route+' activates its panel and renders current data',()=>{
      h.switchTab(route);
      assert.deepEqual(h.tabs.filter(x=>x.active).map(x=>x.dataset.tab),[route]);
      assert.deepEqual(h.panels.filter(x=>x.active).map(x=>x.dataset.panel),[route]);
      assert.ok(h.calls.includes(renderer),'Missing '+renderer+' on first visit to '+route);
      assert.deepEqual(h.errors,[]);
    });
  }
  test(role+': unknown or forbidden navigation falls back to orders',()=>{
    const h=harness(role);h.switchTab('not-a-module');
    assert.deepEqual(h.panels.filter(x=>x.active).map(x=>x.dataset.panel),['orders']);
    assert.ok(h.calls.includes('renderOrders'));
    if(role!=='owner'){
      h.calls.length=0;h.switchTab('settings');
      assert.deepEqual(h.panels.filter(x=>x.active).map(x=>x.dataset.panel),['orders']);
      assert.ok(!h.calls.includes('renderSettings'));
    }
  });
}

for(const role of ['owner','dispatcher_logistic']) {
  test(role+': performance does not recompute the separate hidden shift-closure screen',()=>{
    const h=harness(role);h.switchTab('performance');
    assert.ok(h.calls.includes('renderPerformance'));
    assert.ok(!h.calls.includes('renderShiftClose'),'The shift-close section is separate from performance');
  });
}

test('owner finance navigation selects the installed profit module rather than the obsolete panel',()=>{
  const h=harness('owner',{profitLoaded:true});h.switchTab('finance');
  assert.deepEqual(h.panels.filter(x=>x.active).map(x=>x.dataset.panel),['profit']);
  assert.ok(!h.calls.includes('renderFinance'));
});

test('a loaded owner profit plugin does not grant a dispatcher access to finance',()=>{
  const h=harness('dispatcher_logistic',{profitLoaded:true});h.switchTab('finance');
  assert.deepEqual(h.panels.filter(x=>x.active).map(x=>x.dataset.panel),['orders']);
  assert.ok(!h.calls.includes('renderFinance'));
});

for(const [role,file] of Object.entries(pages)) {
  test(role+': analytics reset clears its shift and drill without changing order-list filters',()=>{
    const html=fs.readFileSync(new URL('../hosted-snapshot/'+file,import.meta.url),'utf8');
    const source=[...html.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)]
      .map(x=>x[1]).find(x=>x.includes('function bind('));
    const ast=parse(source,{sourceType:'module',ecmaVersion:'latest'});
    let callback;
    const visit=node=>{
      if(!node||typeof node!=='object')return;
      if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'
        &&node.left.property.name==='onclick'&&node.left.object.type==='CallExpression'
        &&node.left.object.callee.name==='$'&&node.left.object.arguments[0]?.value==='#clearFilters')callback=node.right;
      for(const value of Object.values(node)){
        if(Array.isArray(value))value.forEach(visit);
        else if(value&&typeof value==='object')visit(value);
      }
    };visit(ast);
    assert.ok(callback,'Reset button must have a bound handler');
    const analytics=['fromDate','toDate','dirFilter','masterFilter','dispFilter','stageFilter','schemeFilter','minCheck','maxCheck','dashboardShift'];
    const orderFilters=['orderSearch','orderStageFilter','masterWorkflowFilter','todayOrdersFilter','tomorrowOrdersFilter'];
    const elements=Object.fromEntries([...analytics,...orderFilters].map(id=>['#'+id,{value:'selected-'+id}]));
    const state={drill:{type:'cash',analyticsScope:true}};
    let refreshed=0;
    const context={$:id=>elements[id],state,refillFilters(){},refresh(){refreshed++},renderDrillBanner(){}};
    vm.runInNewContext('('+source.slice(callback.start,callback.end)+')()',context);
    for(const id of analytics)assert.equal(elements['#'+id].value,'',id+' should reset');
    assert.equal(state.drill,null,'Cross-panel analytical drill should reset');
    for(const id of orderFilters)assert.equal(elements['#'+id].value,'selected-'+id,id+' belongs to the order list');
    assert.equal(refreshed,1);
  });
}
