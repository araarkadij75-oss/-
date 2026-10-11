import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
  assert.deepEqual(s.stableEntryPoints, {
    owner: 'https://araarkadij75-oss.github.io/-/preview/v18.17.21/',
    dispatcherLogistic: 'https://araarkadij75-oss.github.io/-/preview/v18.17.21/dispatcher-logistic.html'
  });
});

test('18.17.19 safety patch keeps delta/delete invariants', () => {
  const p = read('quota-safe-v181719.js');
  assert.match(p, /if\(role!=='owner'\|\|!originalSubscribe\)return originalSubscribe\?originalSubscribe\(profile,onRows\):null/);
  assert.match(p, /Dispatchers must use the primary role-scoped listener/);
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

test('role entrypoints are pinned and mismatched accounts are redirected before data loads', () => {
  assert.match(read('dispatcher-logistic.html'), /MASTER_AI_FORCED_ROLE="dispatcher_logistic"/);
  assert.match(read('master.html'), /MASTER_AI_FORCED_ROLE="master"/);
  assert.match(read('index.html'), /MASTER_AI_FORCED_ROLE="owner"/);
  assert.match(read('dispatcher-logistic.html'), /MASTER_AI_ALLOWED_ROLES=\["dispatcher_logistic"\]/);
  for(const page of ['index.html','dispatcher-logistic.html','master.html']){
    const html=read(page);
    assert.match(html,/if\(!forcedRoleOk\(p\.role\)\)\{await redirectRoleMismatch\(p\.role\)/);
    assert.match(html,/if\(p&&!forcedRoleOk\(p\.role\)\)\{await redirectRoleMismatch\(p\.role\);return\}/);
    assert.match(html,/function roleEntryUrl\(role\)/);
    assert.match(html,/function redirectRoleMismatch\(role\)/);
    const start=html.indexOf('const FORCED_APP_ROLE'),end=html.indexOf('const ROLE_META',start),guard=new Function('window','location','URL','URLSearchParams',html.slice(start,end)+';return {forcedRoleOk,roleEntryUrl}');
    const cfg=page==='index.html'?{MASTER_AI_FORCED_ROLE:'owner'}:page==='master.html'?{MASTER_AI_FORCED_ROLE:'master'}:{MASTER_AI_FORCED_ROLE:'dispatcher_logistic',MASTER_AI_ALLOWED_ROLES:['dispatcher_logistic']};
    const g=guard(cfg,{href:'https://example.test/-/preview/v18.17.21/?release=old&fresh=stale',search:'?release=old&fresh=stale'},URL,URLSearchParams);
    assert.equal(g.roleEntryUrl('owner'),'https://example.test/-/preview/v18.17.21/index.html');
    assert.equal(g.roleEntryUrl('master'),'https://example.test/-/preview/v18.17.21/master.html');
    assert.equal(g.roleEntryUrl('dispatcher_logistic'),'https://example.test/-/preview/v18.17.21/dispatcher-logistic.html');
    assert.equal(g.forcedRoleOk('owner'),page==='index.html');
    assert.equal(g.forcedRoleOk('master'),page==='master.html');
    assert.equal(g.forcedRoleOk('dispatcher_logistic'),page==='dispatcher-logistic.html');
    assert.equal(g.forcedRoleOk('dispatcher'),page==='dispatcher-logistic.html');
    const preview=read('preview/v18.17.21/'+page);
    assert.match(preview,/function roleEntryUrl\(role\)/);
    assert.match(preview,/function redirectRoleMismatch\(role\)/);
  }
});

test('legacy dispatcher and logistic profiles normalize to one dispatcher-logistic role; owner preview keeps owner powers',()=>{
  for(const file of ['index.html','dispatcher-logistic.html','master.html','preview/v18.17.21/index.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.21/master.html','preview/v18.17.22/index.html','preview/v18.17.22/dispatcher-logistic.html','preview/v18.17.22/master.html']){
    const html=read(file);
    assert.match(html,/function canonicalRole\(role\)\{return \['dispatcher','logistic'\]\.includes\(role\)\?'dispatcher_logistic':role\}/);
    assert.match(html,/function currentRole\(\)\{const u=currentUser\(\);return canonicalRole\(/);
    assert.match(html,/if\(ownerPreviewActive\(\)\)\{const owner=ROLE_META\.owner;Object\.assign\(m,\{tabs:owner\.tabs,create:true,edit:true,bulk:true,del:true,money:true,export:true,settings:true,assign:true,cash:true,ownerOverride:true\}\)\}/);
    assert.doesNotMatch(html,/<option value="(?:dispatcher|logistic)">/);
    assert.doesNotMatch(html,/<b>Диспетчер<\/b>|<b>Логист<\/b>/);
    if(file.endsWith('/dispatcher-logistic.html'))assert.ok(html.includes("await window.MasterAICloud.syncNow(state.orders,state.deletedOrders,state.settings,ownerPreviewActive()?'owner':currentRole())"));
  }
  const rules=read('firestore.rules');
  assert.match(rules,/get\(memberPath\(workspace\)\)\.data\.role in \['dispatcher', 'logistic'\][\s\S]{0,120}'dispatcher_logistic'/);
});

test('order saves await Firebase confirmation and commit all order projections atomically',()=>{
  for(const file of ['dispatcher-logistic.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.22/dispatcher-logistic.html']){
    const html=read(file);
    assert.ok(html.includes('cloud.syncNow=async('));
    assert.ok(html.includes("await window.MasterAICloud.syncNow(state.orders,state.deletedOrders,state.settings,ownerPreviewActive()?'owner':currentRole())"));
    assert.ok(html.includes('const saved=await dbWrite();if(!saved){state.orders=ordersBefore;state.audit=auditBefore;return}'));
    assert.ok(html.includes('async function mirrorOrder(r,batch=null)'));
    assert.ok(html.includes('batch.set(closeDataDoc(id),stripUndefined(orderCloseSafe(r)),{merge:true});await batch.commit()'));
  }
});

test('master workflow uses its permitted assignment document', () => {
  for (const file of ['index.html', 'dispatcher-logistic.html', 'master.html']) {
    const html = read(file);
    if (file === 'master.html') {
      assert.match(html, /sourceRef=cloud\.profile\?\.role==='master'\?masterDoc\(orderId\):orderDoc\(orderId\)/);
    } else {
      assert.match(html, /const role=cloud\.profile\?\.role,sourceRef=role==='master'\?masterDoc\(orderId\):\['dispatcher','dispatcher_logistic','logistic'\]\.includes\(role\)\?dispatchDoc\(orderId\):orderDoc\(orderId\)/);
    }
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

test('cloud-only role entrypoints fail closed and escape order identifiers in HTML attributes', () => {
  for (const page of ['index.html','dispatcher-logistic.html','master.html']) {
    const html=read(page);
    assert.match(html,/SECURE_CLOUD_REQUIRED=!!window\.MASTER_AI_BETA_ONLINE&&!!FORCED_APP_ROLE/);
    assert.match(html,/if\(SECURE_CLOUD_REQUIRED&&!cloudMode\(\)\)/);
    assert.match(html,/async function dbRead\(\)\{if\(SECURE_CLOUD_REQUIRED\)return null;/);
    assert.match(html,/if\(!SECURE_CLOUD_REQUIRED&&window\.MASTER_AI_BETA&&!window\.MASTER_AI_BETA_ONLINE\)/);
    assert.match(html,/authMod\.setPersistence\(auth,authMod\.browserSessionPersistence\)/);
    assert.doesNotMatch(html,/\$\{r\._id\}(?:["'`<>\s]|$)/);
  }
});

test('dispatcher-logistic dashboards use a shared all-shifts queue by default', () => {
  assert.match(read('dispatcher-logistic.html'), /profile\.role==='master'\?'masterAssignments':\['dispatcher','dispatcher_logistic','logistic'\]\.includes\(profile\.role\)\?'dispatcherOrders':'orders'/);
  for (const file of ['index.html', 'dispatcher-logistic.html']) {
    const html = read(file);
    assert.match(html, /function roleVisibleOrders\(rows=state\.orders\)[^\n]*return rows\}/);
    assert.match(html, /sharedShiftRoles=\['owner','dispatcher_logistic','logistic'\]/);
    assert.match(html, /shift\.disabled=!sharedShiftRoles\.includes\(role\)/);
    assert.match(html, /Общая очередь включает заказы обеих смен; этот фильтр меняет только аналитику/);
  }
});

test('owner view merges the canonical and dispatcher queues and reads close totals', () => {
  for (const file of ['index.html', 'dispatcher-logistic.html', 'preview/v18.17.21/index.html', 'preview/v18.17.21/dispatcher-logistic.html']) {
    const html = read(file);
    assert.match(html, /const ownerUnion=profile\.role==='owner'/);
    assert.match(html, /fs\.onSnapshot\(canonicalBase/);
    assert.match(html, /fs\.onSnapshot\(dispatchBase/);
    assert.match(html, /const merged=new Map\(\)/);
    assert.match(html, /preferred=dispatchTime>canonicalTime\?r:canonical/);
    assert.match(html, /cloud\.ownerStreamStats=\{canonical:canonicalRows\.length,canonicalUnique:logicalCount\(canonicalRows\),dispatch:dispatchRows\.length,dispatchUnique:logicalCount\(dispatchRows\),union:allRows\.length,stale:!ready/);
    assert.match(html, /ownerStats\.dispatchUnique/);
    assert.match(html, /ownerStats\.canonicalUnique/);
    assert.match(html, /\['owner','dispatcher_logistic','logistic'\]\.includes\(cloud\.profile\?\.role\)/);
    assert.match(html, /\['owner','dispatcher_logistic','logistic'\]\.includes\(currentRole\(\)\)/);
  }
});

test('runtime UI settings cannot replace the readable system font or shrink page typography', () => {
  for (const file of ['index.html','dispatcher-logistic.html','master.html','preview/v18.17.21/index.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.21/master.html']) {
    const html = read(file);
    assert.match(html, /const readableFont='Arial, Helvetica, sans-serif'/);
    assert.match(html, /r\.setProperty\('--font-scale',1\)/);
    assert.doesNotMatch(html, /r\.setProperty\('--font-family',String\(c\.theme\.fontFamily/);
  }
});

test('owner order count exposes both live source totals', () => {
  for (const file of ['index.html', 'dispatcher-logistic.html', 'master.html']) {
    const html = read('preview/v18.17.21/' + file);
    assert.match(html, /ownerMode=currentUser\(\)\?\.role==='owner'&&window\.MasterAICloud\?\.profile\?\.role==='owner',ownerStats=ownerMode\?window\.MasterAICloud\?\.ownerStreamStats:null/);
    assert.match(html, /очередь \$\{ownerStats\.dispatchUnique\} \/ база \$\{ownerStats\.canonicalUnique\}/);
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
    assert.match(html, /data-open="\$\{esc\(r\._id\)\}"/);
    assert.match(html, /function shiftPayroll\(/);
    assert.match(html, /function shiftSnapshot\(/);
    assert.match(html, /salary:shiftPayroll\(cash\)/);
    assert.match(html, /id="f_city"[^>]*value="СПб" readonly/);
    assert.match(html, /function spbArea\(/);
  }
  assert.match(rules, /function validOwnerShiftReport\(/);
  assert.match(rules, /function validShiftClosure\(/);
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
  }
  assert.match(rules, /ownsAssignment\(workspace, orderId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(masterMutableFields\(\)\)/);
});

test('external inbox and API entrypoints are disconnected from beta',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html','sw.js','cloud-config.js'])assert.doesNotMatch(read(f),/src="\.\/(?:b2bhelp-inbox|website-leads-inbox)|website-leads-inbox\.js/);assert.match(read('firestore.rules'),/b2bLeads\/{leadId} \{\s*allow read, write: if false;/);assert.doesNotMatch(read('chinilkin/index.html'),/remontcompsbp\.ru\/api\/website-leads|fonts\.googleapis\.com/) });test('published preview matches the audited disconnected build',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html']){const h=read('preview/v18.17.21/'+f);assert.match(h,/18\.17\.21-CANDIDATE/);assert.match(h,/premium-v181721\.css/);assert.doesNotMatch(h,/src="\.\/(?:b2bhelp-inbox|website-leads-inbox)|script\.google\.com|integrationDiag|MASTER_AI_OPEN_ORDER_FROM_(?:B2B|WEBSITE)|__MASTER_AI_PENDING_(?:B2B|WEBSITE)_LINK|Integrator v18/)}assert.match(read('preview/v18.17.21/sw.js'),/shell-v71/);assert.doesNotMatch(read('preview/v18.17.21/sw.js'),/b2bhelp|website-leads/)});test('EliteService is the visible brand across role pages and install manifests',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html']){const html=read(page);assert.match(html,/<title>EliteService<\/title>/);assert.match(html,/<h1>EliteService<\/h1>/);assert.doesNotMatch(html,/<title>MASTER AI<\/title>|<h1>MASTER AI<\/h1>/)}for(const file of ['manifest.json','manifest-dispatcher-logistic.json','manifest-master.json']){const manifest=JSON.parse(read(file));assert.match(manifest.name,/EliteService/)}assert.match(read('icon.svg'),/>?$/)});
test('owner and dispatcher Firestore sessions expose live sync health and retry failed listeners',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html'])for(const file of [page,'preview/v18.17.21/'+page]){const html=read(file);assert.match(html,/cloud\.subscribe=\(profile,onRows,retrying=false\)/);assert.match(html,/includeMetadataChanges:true/);assert.match(html,/cloud\.syncRetryTimer=setTimeout/);assert.match(html,/cloud\.subscribe\(profile,onRows,true\)/);assert.match(html,/Общая очередь диспетчеров:/);assert.match(html,/ownerSyncState/);assert.doesNotMatch(html,/Онлайн · изменения синхронизируются/);assert.match(html,/updateViaCache:'none'/);assert.match(html,/reg\.update\(\)/)}assert.match(read('sw.js'),/shell-v58/);assert.match(read('preview/v18.17.21/sw.js'),/shell-v71/)});
 test('orders use Saint Petersburg as the fixed city and have no district workflow',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html'])for(const file of [page,'preview/v18.17.21/'+page]){const html=read(file);assert.ok(html.includes('cities:[\"СПб\"]')); assert.match(html,/id=\"f_city\"[^>]*value=\"СПб\" readonly/);assert.doesNotMatch(html,/Район|cityFilter|Выручка по районам/)}});
test('orders can be filtered by visit date today without replacing other filters',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html'])for(const file of [page,'preview/v18.17.21/'+page]){const html=read(file);assert.match(html,/id=\"todayOrdersFilter\"/);assert.match(html,/iso\(parseDate\(r\.visitDate\)\)===day/)}});
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


test('master fixed-rate mode is owner-controlled, account-optional, and excludes closed orders',()=>{
  for(const page of ['index.html','dispatcher-logistic.html','preview/v18.17.21/index.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.22/index.html','preview/v18.17.22/dispatcher-logistic.html']){
    const html=read(page);
    assert.match(html,/data-master-fixed/);
    assert.match(html,/async function setMasterFixedMode\(name,enabled\)\{if\(currentUser\(\)\.role!=='owner'\)/);
    assert.match(html,/cloud\.setMasterFixedMode=async\(uid,enabled\)=>\{if\(cloud\.profile\?\.role!=='owner'\)/);
    assert.match(html,/fixedMasters:Array\.isArray\(x\.fixedMasters\)\?x\.fixedMasters:\[\]/);
    assert.match(html,/fixedMasters:x\.fixedMasters\|\|\[\]/);
    assert.match(html,/isFixed=masterFixedMode\(name\)/);
    assert.match(html,/function masterFixedMode\(name\).*state\.settings\.fixedMasters/);
    const toggle=html.slice(html.indexOf('data-master-fixed'),html.indexOf('data-master-fixed')+180);
    assert.doesNotMatch(toggle,/disabled/,'owner can set fixed mode before creating the master profile');
    assert.match(html,/fixed=!!r\._fixedMaster\|\|masterFixedMode\(r\.master\)/);
    assert.match(html,/r\._cashClosedAt\|\|derivedStage\(r\)==='Выполнен'/);
    assert.match(html,/reviewPct=5,bonus=/);
    assert.match(html,/s_reviewBonus[^>]*readonly/);
    assert.match(html,/checked=!!r\._fixedMaster\|\|masterFixedMode\(r\.master\)/);
    assert.match(html,/\$\$\('\[data-master-fixed\]'\)\.forEach/);
    assert.ok((html.match(/subscribeMemberProfiles\?\.\(rows=>window\.MasterAIApplyMemberProfiles/g)||[]).length>=2,'member profile listener is wired for sign-in and restored sessions');
  }
  assert.ok(read('firestore.rules').includes('match /workspaces/{workspace}/members/{uid}'));
  assert.match(read('firestore.rules'),/allow create, update, delete: if isOwner\(workspace\);/);
  for(const css of ['premium-v181721.css','preview/v18.17.21/premium-v181721.css'])assert.match(read(css),/\.master-pay-mode/);
});

test('order cards show intake and closure actors with honest legacy close state',()=>{
  for(const page of ['index.html','dispatcher-logistic.html','preview/v18.17.21/index.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.22/index.html','preview/v18.17.22/dispatcher-logistic.html']){
    const html=read(page);
    assert.match(html,/function orderResponsibility\(r\)/);
    assert.match(html,/Принял заказ:/);
    assert.match(html,/Закрыл заказ:/);
    assert.match(html,/isClosed=!!closed\|\|!!r\._cashClosedAt\|\|!!r\.closeDate\|\|derivedStage\(r\)==='Выполнен'/);
  }
});


test('review bonus is 5 percent of the clean check capped at 1000 rubles',()=>{
  for(const page of ['index.html','dispatcher-logistic.html','master.html']){
    const html=read(page),start=html.indexOf('function calcAuto('),end=html.indexOf('function orderDate(',start);
    assert.ok(start>=0&&end>start);
    const calc=new Function('state','num','numMaybe','truthReview','masterFixedMode',html.slice(start,end)+';return calcAuto')({settings:{threshold1:4000,threshold2:8000,gridLow:30,gridMid:40,gridHigh:50,fixedRate:40,reviewBonus:5}},v=>Number(v)||0,v=>v===''||v==null?null:Number(v),v=>['1','да','есть','хороший','+'].includes(String(v).toLowerCase()),()=>false);
    assert.equal(calc({total:10000,parts:0,review:'да'}).reviewBonus,500);
    assert.equal(calc({total:10000,parts:0,review:'да'}).master,5500);
    assert.equal(calc({total:50000,parts:0,review:'да'}).reviewBonus,1000);
    assert.equal(calc({total:50000,parts:0,review:'да'}).master,26000);
    assert.equal(calc({total:30000,parts:10000,review:'да'}).master,11000);
    assert.equal(calc({total:50000,parts:0,review:''}).master,25000);
    assert.equal(calc({_fixedMaster:true,total:50000,parts:0,review:'да'}).master,21000);
  }
});


test('owner migration recalculates only open auto-finance review orders',()=>{
  const html=read('index.html'),calcStart=html.indexOf('function calcAuto('),helperStart=html.indexOf('function recalcOpenReviewBonusOrders('),end=html.indexOf('function orderDate(',helperStart);
  const state={settings:{threshold1:4000,threshold2:8000,gridLow:30,gridMid:40,gridHigh:50,fixedRate:50,reviewBonus:5}};
  const num=v=>Number(v)||0,numMaybe=v=>v===''||v==null?null:Number(v),truthReview=v=>['1','да','есть','хороший','+'].includes(String(v).toLowerCase()),derivedStage=r=>r._status||'',currentUser=()=>({id:'owner',name:'Владелец',shift:''}),masterFixedMode=()=>false;
  const calcText=html.slice(calcStart,html.indexOf('function recalcOpenReviewBonusOrders(',calcStart));
  const calc=new Function('state','num','numMaybe','truthReview','masterFixedMode',calcText+';return calcAuto')(state,num,numMaybe,truthReview,masterFixedMode);
  const migrationText=html.slice(helperStart,end);
  const migrate=new Function('num','currentUser','derivedStage','truthReview','calcAuto',migrationText+';return recalcOpenReviewBonusOrders')(num,currentUser,derivedStage,truthReview,calc);
  const open={orderId:'A1',_autoFinance:true,_status:'В работе',review:'да',total:50000,parts:0,cleanCheck:50000,masterAmount:27500,companyShare:22500};
  const paid={orderId:'A2',_autoFinance:true,_cashClosedAt:'2026-01-01',_status:'Выполнен',review:'да',total:50000,parts:0,cleanCheck:50000,masterAmount:27500,companyShare:22500};
  const manual={orderId:'A3',_autoFinance:false,_status:'В работе',review:'да',total:50000,parts:0,cleanCheck:50000,masterAmount:27000,companyShare:23000};
  const result=migrate([open,paid,manual]);assert.equal(result.count,1);assert.equal(result.orders[0].masterAmount,26000);assert.equal(result.orders[0].companyShare,24000);assert.equal(result.orders[1],paid);assert.equal(result.orders[2],manual);
});

test('owner daily payroll reconciliation calculates editable 2/2 shifts and keeps reports separate',()=>{
  const html=read('index.html'),start=html.indexOf('function payrollShiftKey('),end=html.indexOf('function renderWeeklyReports(',start);
  assert.ok(start>=0&&end>start);
  const state={settings:{staff:[],shiftBasePay:2000,shiftCashThreshold:20000,shiftCashRate:10},shiftReports:[],orders:[
    {dispatcher:'Сергей',callDate:'2026-09-01',companyShare:20000,closeDate:'2026-09-03'},
    {dispatcher:'Артём',callDate:'2026-09-01',companyShare:25000,_cashClosedAt:'2026-09-04'},
    {dispatcher:'Артём',callDate:'2026-09-03',companyShare:25000,_cashClosedAt:'2026-09-04'},
    {dispatcher:'Сергей',callDate:'2026-09-02',companyShare:0}
  ]};
  const elements={'#dailyPayrollReconciliation':{hidden:false},'#payrollReconcileMonth':{value:'2026-09'},'#payrollCycleAnchor':{value:'2026-09-01'},'#payrollCycleStart':{value:'sergey'},'#dailyPayrollReconciliationTable':{innerHTML:''},'#dailyPayrollReconciliationNote':{textContent:''}};
  const parse=v=>{const m=String(v||'').match(/^(\d{4})-(\d\d)-(\d\d)$/);return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):null};
  const render=new Function('state','$','currentRole','currentUser','today','norm','shiftOrderDate','num','clean','parseDate','uniqueShiftReports','shiftIntegrity','shiftPayroll','sum','money','integer','esc',html.slice(start,end)+';return {renderDailyPayrollReconciliation,payrollScheduledShift}')(
    state,s=>elements[s],()=> 'owner',()=>({role:'owner'}),()=> '2026-09-01',v=>String(v||'').toLowerCase().replace(/ё/g,'е'),r=>r.callDate,v=>Number(v)||0,v=>String(v||''),parse,rows=>rows,()=>true,cash=>cash>20000?cash*.1:2000,(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0),v=>`${Number(v).toFixed(0)} ₽`,v=>String(v),v=>String(v)
  );
  assert.equal(render.payrollScheduledShift('2026-09-01','2026-09-01','sergey'),'sergey');
  assert.equal(render.payrollScheduledShift('2026-09-02','2026-09-01','sergey'),'sergey');
  assert.equal(render.payrollScheduledShift('2026-09-03','2026-09-01','sergey'),'artem');
  assert.equal(render.payrollScheduledShift('2026-08-31','2026-09-01','sergey'),'artem');
  render.renderDailyPayrollReconciliation();
  assert.match(elements['#dailyPayrollReconciliationTable'].innerHTML,/Итого за месяц/);
  assert.match(elements['#dailyPayrollReconciliationTable'].innerHTML,/60500 ₽/);
  assert.match(elements['#dailyPayrollReconciliationTable'].innerHTML,/Вне графика/);
  assert.match(elements['#dailyPayrollReconciliationTable'].innerHTML,/смена без заказов · базовый оклад/);
  assert.match(elements['#dailyPayrollReconciliationNote'].textContent,/расчёт для сверки/);
  elements['#dailyPayrollReconciliation'].hidden=false;
  const renderStaff=new Function('state','$','currentRole','currentUser','today','norm','shiftOrderDate','num','clean','parseDate','uniqueShiftReports','shiftIntegrity','shiftPayroll','sum','money','integer','esc',html.slice(start,end)+';return renderDailyPayrollReconciliation')(
    state,s=>elements[s],()=> 'dispatcher_logistic',()=>({role:'dispatcher_logistic'}),()=> '2026-09-01',v=>String(v||'').toLowerCase().replace(/ё/g,'е'),r=>r.callDate,v=>Number(v)||0,v=>String(v||''),parse,rows=>rows,()=>true,cash=>cash>20000?cash*.1:2000,(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0),v=>`${Number(v).toFixed(0)} ₽`,v=>String(v),v=>String(v)
  );
  renderStaff();assert.equal(elements['#dailyPayrollReconciliation'].hidden,true);
});

test('owner two-day payroll payout groups both worked shifts and includes late cash exactly in the next cycle',()=>{
  const html=read('preview/v18.17.21/index.html'),start=html.indexOf('function payrollShiftKey('),end=html.indexOf('function renderWeeklyReports(',start);
  assert.ok(start>=0&&end>start);
  const state={settings:{staff:[{id:'s',name:'Сергей',role:'dispatcher_logistic',shift:'sergey'},{id:'a',name:'Артём',role:'dispatcher_logistic',shift:'artem'}]},shiftReports:[
    {id:'2026-09-01-sergey',date:'2026-09-01',shift:'sergey',salary:2000,cash:10000,deferredCash:6000,paidOrderIds:['OLD-1']},
    {id:'2026-09-02-sergey',date:'2026-09-02',shift:'sergey',salary:2500,cash:25000,deferredCash:15000,paidOrderIds:['LATE-1']}
  ]};
  const box={innerHTML:''},parse=v=>{const m=String(v||'').match(/^(\d{4})-(\d\d)-(\d\d)$/);return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):null},iso=d=>d.toISOString().slice(0,10),render=new Function('state','$','norm','parseDate','today','iso','uniqueShiftReports','shiftIntegrity','num','money','esc',html.slice(start,end)+';return {renderTwoDayPayrollPayouts}')(
    state,s=>s==='#payrollCyclePayoutTable'?box:null,v=>String(v||'').toLowerCase().replace(/ё/g,'е'),parse,()=> '2026-10-11',iso,rows=>rows,()=>true,v=>Number(v)||0,v=>`${Number(v).toFixed(0)} ₽`,v=>String(v)
  );
  render.renderTwoDayPayrollPayouts(2026,9,'2026-09-01','sergey',[]);
  assert.match(box.innerHTML,/01\.09\.2026 — 02\.09\.2026/);
  assert.match(box.innerHTML,/Касса за цикл/);
  assert.match(box.innerHTML,/21000 ₽/);
  assert.match(box.innerHTML,/4500 ₽/);
  assert.match(box.innerHTML,/Оба отчёта сверены/);
});

test('historical payroll reports verify against the owner payroll ledger',()=>{
  const html=read('preview/v18.17.21/index.html'),start=html.indexOf('function historicalPayrollDigest('),end=html.indexOf('function renderOwnerShiftApprovals(',start);
  assert.ok(start>=0&&end>start);
  const history={date:'2026-10-10',person:'artem',orders:10,cashCents:2721500,salaryCents:272150};
  const state={payrollHistory:{days:[history]},settings:{shiftBasePay:2000,shiftCashThreshold:20000,shiftCashRate:10,staff:[{id:'a',name:'Артём',role:'dispatcher_logistic',shift:'artem'}]}};
  const num=v=>Number(v)||0,profile=state.settings.staff[0];
  const f=new Function('state','num','pinHash','shiftName','shiftPayroll','shiftSnapshot','legacyShiftSnapshot',html.slice(start,end)+';return {historicalPayrollShiftSnapshot,shiftIntegrity}')(
    state,num,v=>'hash:'+v,v=>v==='artem'?'Смена Артёма':'Смена Сергея',(cash)=>cash>20000?cash*.1:2000,()=>({}),()=>({})
  );
  const report=f.historicalPayrollShiftSnapshot(history,profile);
  Object.assign(report,{subjectMemberId:'a',approvedFor:'a'});
  assert.equal(report.cash,27215);
  assert.equal(report.salary,2721.5);
  assert.equal(f.shiftIntegrity(report),true);
  assert.equal(f.shiftIntegrity({...report,salary:2000}),false);
  assert.equal(f.shiftIntegrity({...report,dataHash:'tampered'}),false);
});

test('historical payroll backfill uses only past ledger rows and skips verified duplicates',async()=>{
  const html=read('preview/v18.17.21/index.html'),start=html.indexOf('async function backfillClosedHistoricalShifts()'),end=html.indexOf('function renderTwoDayPayrollPayouts(',start);
  assert.ok(start>=0&&end>start);
  const backfill=html.slice(start,end);
  assert.doesNotMatch(backfill,/draft\.(?:reportOrigin|historicalSource|legacyReportId|legacyReportPreserved)\s*=/);
  const ledger=[
    {date:'2026-10-08',person:'sergey',orders:10,cashCents:3547300,salaryCents:354700},
    {date:'2026-10-09',person:'artem',orders:9,cashCents:1175000,salaryCents:200000},
    {date:'2026-10-10',person:'artem',orders:10,cashCents:2721500,salaryCents:272150},
    {date:'2026-10-11',person:'sergey',orders:11,cashCents:0,salaryCents:0}
  ];
  const state={payrollHistory:{days:ledger},settings:{staff:[{id:'s',name:'Сергей',role:'dispatcher_logistic',shift:'sergey'},{id:'a',name:'Артём',role:'dispatcher_logistic',shift:'artem'}]},shiftReports:[{id:'2026-10-08-sergey',date:'2026-10-08',shift:'sergey',ownerConfirmed:true}]},created=[],errors=[];
  const elements={'#backfillClosedShifts':{disabled:false},'#backfillStatus':{hidden:true,className:'',textContent:''}},persisted=[];
  const cloud={connected:true,confirmShiftDraft:async r=>{created.push(r.date);persisted.push(r);return r},getShiftReportsForPeriod:async()=>persisted},run=new Function('currentRole','window','$','toast','today','state','currentUser','historicalPayrollShiftSnapshot','shiftIntegrity','dbWrite','renderShiftClose','renderWeeklyReports','norm','num','payrollShiftKey',html.slice(start,end)+';return backfillClosedHistoricalShifts')(
    ()=> 'owner',{MasterAICloud:cloud},s=>elements[s],m=>errors.push(m),()=> '2026-10-11',state,()=>({id:'owner',name:'Owner',role:'owner'}),
    (row,profile)=>({id:row.date+'-'+profile.shift,date:row.date,shift:profile.shift,salary:row.salaryCents/100}),r=>!!r.ownerConfirmed,async()=>{},()=>{},()=>{},v=>String(v||'').toLowerCase(),v=>Number(v)||0,r=>r.shift||''
  );
  await run();
  assert.deepEqual(created,['2026-10-09']);
  assert.match(elements['#backfillStatus'].textContent,/Отчёт владельца записан за 2026-10-09/);
  await run();
  assert.deepEqual(created,['2026-10-09','2026-10-10']);
  assert.match(elements['#backfillStatus'].textContent,/Отчёт владельца записан за 2026-10-10/);
  assert.equal(state.shiftReports.some(r=>r.date>='2026-10-11'),false);
  assert.equal(state.shiftReports.length,3);
});

test('dispatcher-logistic can flag a master review bonus and persist it with close data',()=>{
  for(const file of ['dispatcher-logistic.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.22/dispatcher-logistic.html']){
    const html=read(file);
    assert.ok(html.includes('f_masterTookReview'));
    assert.ok(html.includes("review:['dispatcher_logistic','logistic'].includes(currentRole())?($('#f_masterTookReview')?.checked?'да':''):get('f_review')"));
    assert.ok(html.includes("'review','closeDate','_cashClosedAt'"));
  }
  assert.ok(read('firestore.rules').includes("'orderId','parts','total','review'"));
});

test('stalled sync retries and stable clients use adaptive Firestore transport',()=>{for(const file of ['index.html','dispatcher-logistic.html','master.html','preview/v18.17.21/index.html','preview/v18.17.21/dispatcher-logistic.html','preview/v18.17.21/master.html']){const html=read(file);assert.match(html,/cloud\.serverAckTimer=setTimeout/);assert.match(html,/Firebase не подтвердил загрузку общей очереди/);assert.match(html,/cloud\.retrySync=\(\)=>/);if(['preview/v18.17.21/index.html','preview/v18.17.21/dispatcher-logistic.html'].includes(file)){assert.match(html,/scheduleRetry\(message\)/);assert.match(html,/experimentalAutoDetectLongPolling:true/);assert.doesNotMatch(html,/experimentalForceLongPolling:true/)}else assert.match(html,/Нажмите индикатор «Подключение» для повтора/);assert.match(html,/role=\"button\" tabindex=\"0\"/);assert.match(html,/cloudBadge\.onclick=retryCloud/);assert.match(html,/cloudBadge\.onkeydown=/)}assert.match(read('preview/v18.17.21/sw.js'),/shell-v71/)});

test('owner can safely backfill employee queue without touching finance or newer staff edits',()=>{const html=read('preview/v18.17.21/index.html');assert.match(html,/cloud\.backfillDispatcherOrders=async/);assert.match(html,/if\(cloud\.profile\?\.role!=='owner'\)throw new Error\('Только владелец'\)/);assert.match(html,/dispatchTime>=sourceTime/);assert.match(html,/dispatchSafe\(\{\.\.\.source\.data\(\),orderId:id\}\)/);assert.match(html,/batch\.set\(dispatchDoc\(item\.id\),stripUndefined\(item\.row\),\{merge:false\}\)/);assert.match(html,/Сергея и Артёма/);assert.match(html,/backfillDispatcherOrders/)});

test('stable role entrypoints keep a failed sync visible until the server confirms recovery',()=>{const owner=read('preview/v18.17.21/index.html'),dispatcher=read('preview/v18.17.21/dispatcher-logistic.html');assert.match(owner,/connectionError=''/);assert.match(owner,/MasterAICloud\?\.connectionError/);assert.match(dispatcher,/connectionError:''/);assert.match(dispatcher,/connectionError=String\(message\|\|'Ошибка подключения'\)/);assert.match(dispatcher,/connectionError='';clearTimeout\(cloud\.syncRetryTimer\)/);assert.match(dispatcher,/MasterAICloud\?\.connectionError/)});

test('dispatcher live server snapshot marks the shared queue online',()=>{const html=read('preview/v18.17.21/dispatcher-logistic.html');assert.match(html,/if\(!cached\)\{confirmServerSync\(\);window\.MasterAICloudStatus\?\.\('ok','Общая очередь подтверждена сервером Firebase · '\+allRows\.length\+' заказов'\)\}/)});test('dispatcher sync retry verifies current-user server access and surfaces exact Firebase errors',()=>{const html=read('preview/v18.17.21/dispatcher-logistic.html');assert.match(html,/cloud\.probeServer=async/);assert.match(html,/getDocsFromServer\(query\)/);assert.match(html,/Проверка Firebase не прошла/);assert.match(html,/err\?\.code/);assert.match(html,/setAttribute\('aria-label','Состояние облачной синхронизации\./)});
