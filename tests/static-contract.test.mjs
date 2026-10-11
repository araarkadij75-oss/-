import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');

test('release state pins safe environment', () => {
  const s = JSON.parse(read('release-state.json'));
  assert.equal(s.baseCurrent, '18.17.18-CURRENT');
  assert.equal(s.environment.firebaseProject, 'master-ai-beta-9440599');
  assert.equal(s.environment.workspace, 'master-ai-beta');
  assert.equal(s.environment.billing, 'Spark / NO BILLING');
  assert.equal(s.syncContract.mode, 'firebase_realtime');
  assert.equal(s.syncContract.externalConnectors, false);
  assert.equal(s.syncContract.b2bhelp, false);
  assert.equal(s.syncContract.googleSheets, false);
  assert.equal(s.syncContract.avito, false);
  assert.equal(s.promotion.allowed, false);
});

test('18.17.19 safety patch keeps delta/delete invariants', () => {
  const p = read('quota-safe-v181719.js');
  assert.match(p, /canonicalDeleteSafety:true/);
  assert.match(p, /fullReconcileMode:'manual_only'/);
  assert.match(p, /legacyAutoFullSyncBlocked:true/);
  assert.match(p, /autoFlushOnOpen:false/);
  assert.match(p, /focusPull:false/);
  assert.match(p, /retryLimit:5/);
  assert.match(p, /function bridgeEndpoint\(\)\{return''\}/);
  assert.match(p, /function bridgeReady\(\)\{return false\}/);
  assert.match(p, /async function bridgePost\(\)\{throw new Error\('Внешние интеграции отключены'\)\}/);
  assert.doesNotMatch(p, /fetch\(/);
  assert.match(p, /function bridgeEndpoint\(\)\{return''\}/);
  assert.match(p, /function bridgeReady\(\)\{return false\}/);
  assert.match(p, /async function bridgePost\(\)\{throw new Error\('Внешние интеграции отключены'\)\}/);
  assert.doesNotMatch(p, /fetch\(/);
  assert.doesNotMatch(p, /\bphoneAccess\b/);
});

test('role entrypoints are pinned', () => {
  assert.match(read('dispatcher-logistic.html'), /MASTER_AI_FORCED_ROLE="dispatcher_logistic"/);
  assert.match(read('master.html'), /MASTER_AI_FORCED_ROLE="master"/);
});

test('master workflow uses its permitted assignment document', () => {
  for (const file of ['index.html', 'dispatcher-logistic.html', 'master.html']) {
    const html = read(file);
    assert.match(html, /sourceRef=cloud\.profile\?\.role==='master'\?masterDoc\(orderId\):orderDoc\(orderId\)/);
    assert.doesNotMatch(html, /await window\.MasterAICloud\.cleanupTechnicalArtifacts\?\.\(\)/);
  }
});

test('legacy production project is absent from runtime cloud config', () => {
  const c = read('cloud-config.js');
  assert.match(c, /master-ai-beta-9440599/);
  assert.doesNotMatch(c, /projectId\s*:\s*["']master-ai-9440599["']/);
});

test('external Google integration is disabled in the CRM',()=>{for(const f of ['cloud-config.js','index.html','dispatcher-logistic.html','master.html'])assert.doesNotMatch(read(f),/https:\/\/script\.google\.com|id="s_google|id="googleSync"|window\.open\(.*google/i);for(const f of ['index.html','dispatcher-logistic.html','master.html']){assert.match(read(f),/cloud\.requestGoogleSync=async\(\)=>null/);assert.match(read(f),/googleCoordinatorRole=\(\)=>false/)}});test('external connector hydration is disabled without disturbing Firebase roles',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html']){const h=read(f);assert.match(h,/if\(!\['owner','dispatcher_logistic','logistic'\]\.includes\(cloud\.profile\?\.role\|\|''\)\)return\[\]/);assert.match(h,/cloud\.getGoogle=async\(\)=>\(\{\}\)/);assert.match(h,/cloud\.requestGoogleSync=async\(\)=>null/)}});test('all executable JavaScript parses', () => {
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = read(file);
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1])
      .filter(s => s.trim());
    assert.ok(scripts.length >= 2, file + ': expected inline scripts');
    for (const [i, script] of scripts.entries()) {
      assert.doesNotThrow(() => new Function(script), file + ': inline script ' + i + ' syntax');
    }
  }
  for (const file of ['cloud-config.js','quota-safe-v181719.js','sw.js']) {
    assert.doesNotThrow(() => new Function(read(file)), file + ': syntax');
  }
});

test('all PWA manifests parse and use role-correct start URLs', () => {
  const expected = {
    'manifest.json':'./index.html',
    'manifest-dispatcher-logistic.json':'./dispatcher-logistic.html',
    'manifest-master.json':'./master.html'
  };
  for (const [file,start] of Object.entries(expected)) {
    const m = JSON.parse(read(file));
    assert.equal(m.start_url, start);
    assert.equal(m.display, 'standalone');
    assert.ok(Array.isArray(m.icons) && m.icons.length > 0);
  }
});

test('premium responsive design is shared by every role client', () => {
  const css = read('premium-v181721.css');
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    assert.match(read(file), /premium-v181721\.css\?v=181735/);
  }
  assert.match(css, /@media\(max-width:800px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /#roleWorkGuide\[hidden\]\{display:none!important\}/);
  assert.match(css, /--zone-blue:#f1f6ff/);
  assert.match(css, /#orderForm>\.form-section\.client-section/);
  assert.match(css, /#orderForm \.finance-details/);
  assert.match(css, /\.top\{position:relative!important;top:auto!important/);
  assert.match(css, /#enableNotificationsTop,\.top-actions #logoutBtn\{display:inline-flex!important/);
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    assert.match(read(file), /if\(role==='owner'\)\{el\.hidden=true;el\.replaceChildren\(\);return\}/);
  }
  assert.match(read('sw.js'), /premium-v181721\.css/);
});

test('dashboard uses decision-oriented KPI definitions', () => {
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = read(file);
    assert.match(html, /completionRate:eligible\?closed\/eligible\*100/);
    assert.match(html, /reviewRate:closed\?reviewN\/closed\*100/);
    assert.match(html, /Активные заказы/);
    assert.match(html, /Фокус руководителя/);
    assert.match(html, /Оборот и касса во времени/);
    assert.match(html, /renderExecutiveSummary\(k\)/);
  }
});

test('dispatcher-logistic dashboards use a shared all-shifts queue by default', () => {
  for (const file of ['index.html', 'dispatcher-logistic.html']) {
    const html = read(file);
    assert.match(html, /function roleVisibleOrders\(rows=state\.orders\)[^\n]*return rows\}/);
    assert.match(html, /sharedShiftRoles=\['owner','dispatcher_logistic','logistic'\]/);
    assert.match(html, /shift\.disabled=!sharedShiftRoles\.includes\(role\)/);
    assert.match(html, /Общая очередь включает заказы обеих смен; этот фильтр меняет только аналитику/);
  }
});

test('dashboard shows every day in the selected cash period', () => {
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = read(file);
    assert.match(html, /id="dailyCash"/);
    assert.match(html, /function renderDailyCash\(rows\)/);
    assert.match(html, /while\(cursor<=end&&days\.length<366\)/);
    assert.match(html, /renderDailyCash\(rows\)/);
    assert.match(html, /Касса по дням/);
  }
});

test('dispatcher identity is account-bound across clients and rules', () => {
  const rules = read('firestore.rules');
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = read(file);
    assert.match(html, /function lockedDispatcher\(/);
    assert.match(html, /id="staffLogin"/);
    assert.match(html, /id="presetSergey"/);
    assert.match(html, /id="presetArtem"/);
    assert.match(html, /_updatedByName:currentUser\(\)\.name/);
  }
  assert.match(rules, /function validCreatorIdentity\(/);
  assert.match(rules, /function validUpdateIdentity\(/);
  assert.match(rules, /creatorIdentityUnchanged\(\)/);
});

test('shift close, protected payroll, and Saint Petersburg analytics ship together', () => {
  const rules = read('firestore.rules');
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = read(file);
    assert.match(html, /id="closeShiftBtn"/);
    if (file !== 'master.html') {
      assert.match(html, /data-tab="shiftclose"/);
      if (file === 'dispatcher-logistic.html') assert.match(html, /dispatcher_logistic:\{label:'[^']+',tabs:\['orders','dashboard','performance','mastershifts','shiftclose'\]/);
      assert.match(html, /Сохранить неделю/);
      assert.match(html, /id="weeklyReportList"/);
      if (file === 'dispatcher-logistic.html') {
        assert.match(html, /dispatcher_logistic:\{label:'[^']+',tabs:\['orders','dashboard','performance','mastershifts','shiftclose'\]/);
        assert.doesNotMatch(html, /dispatcher_logistic:\{label:'[^']+',tabs:\[[^\]]*'reports'/);
      }
      assert.match(html, /where\('closedBy','==',cloud\.profile\?\.id/);
      assert.match(html, /cloud\.saveMasterWeek/);
      assert.match(html, /cloud\.closeWeek/);
      assert.match(html, /requestMasterWeekLoad/);
      assert.match(html, /function mergeMasterShiftCache/);
      assert.match(html, /sorted\.slice\(0,60\)/);
      assert.match(html, /masterWeekDirty/);
      assert.match(html, /state\.weeklyShiftReports=Array\.isArray\(d\.weeklyShiftReports\)/);
      assert.match(html, /filter\(shiftIntegrity\)/);
      assert.match(html, /2 смены × 7 дней; нет отчёта или сверки/);
    }
    if (file === 'master.html') {
      assert.match(html, /id="dailyShiftReports"/);
    }
    assert.match(html, /id="addRosterMaster"/);
    assert.match(html, /function removeRosterMaster\(/);
    if (file === 'master.html') assert.match(html, /\.slice\(0,14\)/);
    assert.match(html, /data-panel="mastershifts"/);
    assert.match(html, /function onDutyMasters\(/);
    assert.match(html, /class="quick-chip \$\{working\?'on-duty'/);
    assert.match(html, /function renderStaff\(/);
    assert.match(html, /batch=fs\.writeBatch\(db\)/);
    assert.match(html, /function prepareMasterAccount\(/);
    assert.match(html, /role==='master'\?'':\(\$\('#staffShift'/);
    assert.match(html, /function openOrderDetails\(/);
    assert.match(html, /card\.onclick=open/);
    assert.match(html, /data-open="\$\{r\._id\}"/);
    assert.match(html, /function shiftPayroll\(/);
    assert.match(html, /function shiftSnapshot\(/);
    assert.match(html, /salary:shiftPayroll\(cash\)/);
    assert.match(html, /Район Санкт‑Петербурга/);
    assert.match(html, /function spbArea\(/);
  }
  assert.match(rules, /function validShiftReport\(/);
  assert.match(rules, /config\/payroll/);
  assert.match(rules, /weeklyShiftReports/);
  assert.match(rules, /function readsOwnShiftReport\(workspace\)/);
  assert.match(rules, /shiftReports/);
});

test('late cash settlements roll into the original shift exactly once', () => {
  const source = read('index.html');
  const payroll = source.match(/function shiftPayroll\([^\n]+/);
  assert.ok(payroll, 'payroll calculation exists');
  const calculate = new Function('num', `return (${payroll[0]})`)(value => Number(value) || 0);
  assert.equal(calculate(35000, { shiftBasePay: 2000, shiftCashThreshold: 20000, shiftCashRate: 10 }), 3500);
  assert.equal(calculate(20000, { shiftBasePay: 2000, shiftCashThreshold: 20000, shiftCashRate: 10 }), 2000);
  assert.match(source, /function shiftSettlementOrders\(/);
  assert.match(source, /r\.paidOrderIds\)\?r\.paidOrderIds/);
  assert.match(source, /!r\._cashClosedAt/);
  assert.match(source, /deferredOrderIds/);
  assert.match(source, /id="payrollAccrualTable"/);
  assert.match(read('firestore.rules'), /request\.resource\.data\.shiftCash \+ request\.resource\.data\.deferredCash == request\.resource\.data\.cash/);
  const settlementSource = source.match(/function shiftSettlementOrders\([^\n]+/);
  const settlementState = { shiftReports: [{ closedBy: 'sergey', date: '2026-10-09', orderIds: ['already-paid'] }], orders: [
      { orderId: 'late-old', _createdByShift: 'sergey', callDate: '2026-10-05', _cashClosedAt: '2026-10-11T10:00:00Z', companyShare: 3000 },
      { orderId: 'same-day', _createdByShift: 'sergey', callDate: '2026-10-11', _cashClosedAt: '2026-10-11T11:00:00Z', companyShare: 32000 },
      { orderId: 'already-paid', _createdByShift: 'sergey', callDate: '2026-10-08', _cashClosedAt: '2026-10-11T12:00:00Z', companyShare: 9000 },
      { orderId: 'artem', _createdByShift: 'artem', callDate: '2026-10-08', _cashClosedAt: '2026-10-11T12:00:00Z', companyShare: 4000 }
    ] };
  settlementState.orders.forEach(r => { r._cashClosedOn = '2026-10-11'; });
  const settlement = new Function('state', 'num', 'String', 'norm', 'iso', 'parseDate', `return (${settlementSource[0]})`)(
    settlementState, value => Number(value) || 0, String, value => String(value || '').toLowerCase(),
    value => typeof value === 'string' ? value.slice(0, 10) : '', value => value
  );
  const sergey = { id: 'sergey', name: 'Сергей', shift: 'sergey' };
  assert.deepEqual(settlement('2026-10-11', sergey).map(r => r.orderId), ['late-old', 'same-day']);
  assert.deepEqual(settlement('2026-10-10', sergey), [], 'a future surrender cannot affect an earlier shift');
  settlementState.shiftReports.push({ closedBy: 'sergey', date: '2026-10-11', paidOrderIds: ['late-old', 'same-day'] });
  assert.deepEqual(settlement('2026-10-12', sergey), [], 'paid order IDs do not accrue twice');
});

test('master clients cannot open or submit the generic order editor', () => {
  const rules = read('firestore.rules');
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = read(file);
    assert.match(html, /if\(currentRole\(\)==='master'\)\{toast\('Изменение заказа мастеру недоступно'\);return\}/);
    assert.match(html, /if\(id==='orderModal'\)applyOrderFormPermissions\(\)/);
    assert.match(html, /if\(!can\('edit'\)\)\{toast\('Недостаточно прав для изменения заказа'\);return\}/);
    assert.match(html, /if\(role==='master'\)\{\$\$\('#orderForm input,#orderForm select,#orderForm textarea,#orderForm button'\)/);
  }
  assert.match(rules, /ownsAssignment\(workspace, orderId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(masterMutableFields\(\)\)/);
});

test('external inbox and API entrypoints are disconnected from beta',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html','sw.js','cloud-config.js'])assert.doesNotMatch(read(f),/src="\.\/(?:b2bhelp-inbox|website-leads-inbox)|website-leads-inbox\.js/);assert.match(read('firestore.rules'),/b2bLeads\/{leadId} \{\s*allow read, write: if false;/);assert.doesNotMatch(read('chinilkin/index.html'),/remontcompsbp\.ru\/api\/website-leads|fonts\.googleapis\.com/) });test('published preview matches the audited disconnected build',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html']){const h=read('preview/v18.17.21/'+f);assert.match(h,/18\.17\.21-CANDIDATE/);assert.match(h,/premium-v181721\.css/);assert.doesNotMatch(h,/src="\.\/(?:b2bhelp-inbox|website-leads-inbox)|script\.google\.com|integrationDiag|MASTER_AI_OPEN_ORDER_FROM_(?:B2B|WEBSITE)|__MASTER_AI_PENDING_(?:B2B|WEBSITE)_LINK|Integrator v18/)}assert.match(read('preview/v18.17.21/sw.js'),/shell-v39/);assert.doesNotMatch(read('preview/v18.17.21/sw.js'),/b2bhelp|website-leads/)});test('orders can be filtered by visit date today without replacing other filters',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html']){const html=read(page);assert.match(html,/id="todayOrdersFilter"/);assert.match(html,/iso\(parseDate\(r\.visitDate\)\)===day/);assert.match(html,/todayOrdersFilter'\)\.onclick=\(\)=>\{/);assert.equal(html,read('preview/v18.17.21/'+page))}});
test('weekly schedule ignores stale loads and locks edits while saving', () => {
  for (const page of ['index.html', 'dispatcher-logistic.html']) {
    const html = read(page);
    assert.match(html, /masterWeekRequest=0/);
    assert.match(html, /const request=\+\+masterWeekRequest/);
    assert.match(html, /if\(request!==masterWeekRequest\)return/);
    assert.match(html, /masterWeekSaving=true/);
    assert.match(html, /\$\$\('#masterShiftPicker input'\)\.forEach\(x=>x\.disabled=true\)/);
    assert.match(html, /finally\{masterWeekSaving=false/);
  }
});
