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

test('REG.RU release helper stages only an explicit replace allowlist and hashes every payload file', () => {
  const script = read('scripts/prepare-regru-release.mjs');
  assert.match(script, /productionReplaceAllowlist:\s*\['index\.html', 'dispatcher-logistic\.html', 'master\.html', 'sw\.js'\]/);
  assert.match(script, /protectedPaths:\s*\['crm-api\/', 'cloud-config\.js', 'firestore-regru\.js'/);
  assert.match(script, /createHash\('sha256'\)/);
  assert.match(script, /hosted-snapshot/);
  assert.doesNotMatch(script, /crm-api.*copyFile|copyFile.*crm-api/);
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

test('owner deletes every order projection from the supplied deletion list exactly once per session',async()=>{
  for(const file of ['index.html','dispatcher-logistic.html','hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html']){
    const html=read(file),start=html.indexOf('async function persistDeleteTombstones(deleted)'),end=html.indexOf('\n',start);
    assert.ok(start>=0&&end>start,file+': delete IDs come from current CRM state');
    const helper=new Function(html.slice(start,end)+';return persistDeleteTombstones')();
    assert.deepEqual(await helper([{orderId:'TEST-DELETE-1'},{orderId:'TEST-DELETE-1'},{orderId:'TEST-DELETE-2'},{}]),['TEST-DELETE-1','TEST-DELETE-2']);
    assert.match(html,/appliedDeleteIds:new Set\(\)/,file+': avoid repeated Firestore deletes');
    assert.match(html,/tombstones\.filter\(id=>!cloud\.appliedDeleteIds\.has\(id\)\)/,file+': schedule new deletes');
    assert.match(html,/deleteDoc\(orderDoc\(id\)\)[\s\S]{0,180}cloud\.appliedDeleteIds\.add\(id\)/,file+': remove canonical and role projections before marking complete');
  }
});

test('unassigned orders keep role projections atomic without dispatcher deletes',()=>{
  for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html']){
    const html=read(file),start=html.indexOf('async function mirrorOrder(r,batch=null)'),end=html.indexOf('if(!batch)await b.commit()',start);
    assert.ok(start>=0&&end>start,file+': batch-aware mirror writer');
    const mirror=html.slice(start,end);
    assert.match(mirror,/else if\(cloud\.profile\?\.role==='owner'\)\{b\.delete\(masterDoc\(id\)\);b\.delete\(phoneDoc\(id\)\)\}/,file+': only owner removes projections');
    assert.match(mirror,/b\.set\(masterDoc\(id\),stripUndefined\(masterSafe\(r,''\)\)/,file+': unassigned master projection revokes access without deletion');
    assert.match(mirror,/b\.set\(phoneDoc\(id\),\{orderId:id,phone:'',masterUid:''/,file+': unassigned phone projection contains no phone');
    assert.match(html,/await mirrorOrder\(r,batch\);await batch\.commit\(\)/,file+': canonical and role projections commit together');
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

test('REG.RU candidate persists fixed-pay and master grid settings in a shared protected document', () => {
  for (const file of ['hosted-snapshot/index.html', 'hosted-snapshot/dispatcher-logistic.html', 'hosted-snapshot/master.html']) {
    const html = read(file);
    assert.match(html, /cloud\.saveFinanceSettings=async x=>\{if\(cloud\.profile\?\.role!=='owner'\)/, file);
    assert.match(html, /configDoc\('financePolicy'\),payload,\{merge:true\}/, file);
    assert.match(html, /cloud\.subscribeMasterRoster=cb=>[\s\S]{0,800}configDoc\('financePolicy'\)/, file);
    assert.match(html, /window\.MasterAIApplyMasterRoster=cfg=>[\s\S]{0,800}state\.settings=\{\.\.\.state\.settings,\.\.\.next\}/, file);
    const saveStart = html.indexOf('async function saveSettings(){');
    const saveEnd = html.indexOf('}', saveStart) + 1;
    const save = html.slice(saveStart, saveEnd + 1200);
    assert.match(save, /if\(cloudMode\(\)&&currentRole\(\)!=='owner'\)/, file + ': cloud settings require the owner');
    assert.match(save, /saveFinanceSettings\?\.\(\{threshold1:state\.settings\.threshold1[\s\S]{0,300}fixedRate:state\.settings\.fixedRate\}\)/, file + ': persist the percent and grid');
    assert.match(html, /subscribeMasterRoster\?\.\(cfg=>window\.MasterAIApplyMasterRoster\?\.\(cfg\)\)/, file + ': live settings subscription');
  }
  for (const file of ['hosted-snapshot/index.html', 'hosted-snapshot/dispatcher-logistic.html']) {
    const html = read(file);
    assert.match(html, /f=await fs\.getDoc\(configDoc\('financePolicy'\)\),y=f\.exists\(\)\?f\.data\(\):\{\}/, file);
    assert.match(html, /role==='master'\?\{\}:finance/, file + ': master profile does not receive finance grid');
  }
  for (const file of ['hosted-snapshot/index.html', 'hosted-snapshot/dispatcher-logistic.html', 'hosted-snapshot/master.html']) {
    const scripts = [...read(file).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
    for (const [i, script] of scripts.entries()) assert.doesNotThrow(() => new Function(script), file + ': inline script ' + i + ' syntax');
  }
});

test('legacy production project is absent from runtime cloud config', () => {
  const c = read('cloud-config.js');
  assert.match(c, /master-ai-beta-9440599/);
  assert.doesNotMatch(c, /projectId\s*:\s*["']master-ai-9440599["']/);
});

test('external Google integration is disabled in the CRM',()=>{for(const f of ['cloud-config.js','index.html','dispatcher-logistic.html','master.html'])assert.doesNotMatch(read(f),/https:\/\/script\.google\.com|id="s_google|id="googleSync"|window\.open\(.*google/i);for(const f of ['index.html','dispatcher-logistic.html','master.html']){assert.match(read(f),/cloud\.requestGoogleSync=async\(\)=>null/);assert.match(read(f),/googleCoordinatorRole=\(\)=>false/)}});test('external connector hydration is disabled without disturbing Firebase roles',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html']){const h=read(f);assert.match(h,/if\(!\['owner','dispatcher_logistic','logistic'\]\.includes\(cloud\.profile\?\.role\|\|''\)\)return\[\]/);assert.match(h,/cloud\.getGoogle=async\(\)=>\(\{\}\)/);assert.match(h,/cloud\.requestGoogleSync=async\(\)=>null/)}});test('all executable JavaScript parses', () => {
  for (const file of ['index.html','dispatcher-logistic.html','master.html','hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']) {
    const html = read(file);
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1])
      .filter(s => s.trim());
    assert.ok(scripts.length >= 2, file + ': expected inline scripts');
    for (const [i, script] of scripts.entries()) {
      assert.doesNotThrow(() => new Function(script), file + ': inline script ' + i + ' syntax');
    }
  }
  for (const file of ['cloud-config.js','quota-safe-v181719.js','sw.js','hosted-snapshot/sw.js']) {
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

test('master role maps unique abbreviated order names without exposing ambiguous assignments', () => {
  const html=read('hosted-snapshot/index.html');
  const start=html.indexOf('function masterNamesEquivalent'),end=html.indexOf('function roleVisibleOrders',start);
  assert.ok(start>=0&&end>start,'master identity helpers are present before role filtering');
  const canonicalKey=(value)=>String(value??'').trim().toLowerCase().replace(/ё/g,'е').replace(/[.]/g,'').replace(/\s+/g,' ');
  const helpers=new Function('canonicalKey','unique','state','PRESETS',html.slice(start,end)+';return {masterNamesEquivalent,masterRoleOrderMatch}');
  const unique=(items)=>[...new Set(items)];
  const state={settings:{masterRoster:['Пак Семён'],staff:[{role:'master',active:true,master:'Пак Семён'}]}};
  const run=helpers(canonicalKey,unique,state,{masters:[]});
  assert.equal(run.masterNamesEquivalent('Пак С.','Пак Семён'),true);
  assert.equal(run.masterRoleOrderMatch('Пак С.','Пак Семён'),true);
  assert.equal(run.masterRoleOrderMatch('Пак С.','Семёнов Павел'),false);
  state.settings.masterRoster.push('Пак Савченков');
  assert.equal(run.masterRoleOrderMatch('Пак С.','Пак Семён'),false,'ambiguous initials must not reveal the order');
  for(const file of ['index.html','dispatcher-logistic.html','master.html','hosted-snapshot/index.html','hosted-snapshot/master.html']){
    assert.match(read(file),/function roleVisibleOrders\(rows=state\.orders\)[^\n]*masterRoleOrderMatch\(r\.master,master\)/,file+' uses alias-safe role filtering');
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
        assert.match(html, /lockedOrderIds:\[\.\.\.new Set\(rows\.filter\(r=>!isPickupOrder\(r\)\)/);
        assert.match(html, /cloud\.closeShift=async report=>[\s\S]*?await fs\.setDoc\(shiftClosureDoc\(id\),stripUndefined\(payload\),\{merge:false\}\);for\(let i=0;i<lockedOrderIds\.length;i\+=2\)/);
        assert.match(html, /cloud\.confirmShiftReport=async report=>[\s\S]*?serverApprovedAt:fs\.serverTimestamp\(\)/);
        assert.match(html, /function confirmClosedShift\(r\)/);
        assert.match(html, /data-confirm-shift/);
        assert.match(html, /\$\$\('\[data-share-shift\]'\)\.forEach/);
        assert.match(html, /r\.closureOnly\?\(r\.orderIds\|\|\[\]\)\.length/);
        assert.match(html, /function closureOrderDetailsHtml\(r,role\)/);
        assert.match(html, /memberId=r\.subjectMemberId\|\|r\.closedBy/);
        assert.match(html, /r\.subjectMemberId===profile\.id/);
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

test('cash payroll stays with the order shift and deferred orders are claimed once', () => {
  const source = read('hosted-snapshot/index.html');
  const payroll = source.match(/function shiftPayroll\([^\n]+/);
  assert.ok(payroll, 'payroll calculation exists');
  const calculate = new Function('num', `return (${payroll[0]})`)(value => Number(value) || 0);
  assert.equal(calculate(35000, { shiftBasePay: 2000, shiftCashThreshold: 20000, shiftCashRate: 10 }), 3500);
  assert.equal(calculate(20000, { shiftBasePay: 2000, shiftCashThreshold: 20000, shiftCashRate: 10 }), 2000);
  assert.match(source, /function shiftSettlementOrders\(/);
  assert.match(source, /function shiftSettlementDate\(/);
  assert.match(source, /r\.paidOrderIds\)\?r\.paidOrderIds:\[\]/);
  assert.match(source, /!r\._cashClosedAt/);
  assert.match(source, /deferredOrderIds/);
  assert.match(source, /id="payrollAccrualTable"/);
  assert.match(read('firestore.rules'), /request\.resource\.data\.shiftCash \+ request\.resource\.data\.deferredCash == request\.resource\.data\.cash/);
  const settlementSource = source.match(/function shiftSettlementOrders\([^\n]+/);
  const orderShiftSource=source.match(/function orderPayrollShift\([^\n]+/);
  assert.ok(orderShiftSource,'payroll owner resolver exists');
  const settlementState = { settings:{staff:[{id:'sergey',name:'Сергей',shift:'sergey'},{id:'artem',name:'Артём',shift:'artem'}]},shiftReports: [{ approvedFor: 'sergey', date: '2026-10-09', paidOrderIds: ['already-paid'] }], orders: [
      { orderId: 'sergey-order-closed-by-artem', _createdByShift: 'sergey', callDate: '2026-10-05', _cashClosedOn: '2026-10-11', _cashClosedAt: '2026-10-11T10:00:00Z', _cashClosedBy:'artem', _cashClosedByName:'Артём', companyShare: 3000 },
      { orderId: 'sergey-same-day-closed-by-artem', _createdByShift: 'artem', dispatcher:'Сергей', callDate: '2026-10-11', _cashClosedOn: '2026-10-11', _cashClosedAt: '2026-10-11T11:00:00Z', _cashClosedBy:'artem', _cashClosedByName:'Артём', companyShare: 32000 },
      { orderId: 'already-paid', _createdByShift: 'sergey', callDate: '2026-10-08', _cashClosedOn: '2026-10-11', _cashClosedAt: '2026-10-11T12:00:00Z', _cashClosedBy:'sergey', _cashClosedByName:'Сергей', companyShare: 9000 },
      { orderId: 'sergey-order-closed-by-sergey', _createdByShift: 'sergey', callDate: '2026-10-08', _cashClosedOn: '2026-10-11', _cashClosedAt: '2026-10-11T12:30:00Z', _cashClosedBy:'sergey', _cashClosedByName:'Сергей', companyShare: 4000 },
      { orderId: 'artem-owner-sergey-metadata', _createdByShift: 'sergey', dispatcher:'Артем', callDate:'2026-10-11', _cashClosedOn:'2026-10-11', companyShare:500 }
    ] };
  const payrollShiftKey=report=>{const raw=String(report.shift||report.id||report.approvedFor||'').toLowerCase(),label=String(report.approvedForName||report.shiftName||report.closedByName||'').toLowerCase().replace(/ё/g,'е');if(raw.includes('artem')||raw==='2'||label.includes('арт'))return'artem';if(raw.includes('sergey')||raw==='1'||label.includes('серг'))return'sergey';return''};
  const orderPayrollShift=new Function('state','norm','payrollShiftKey',`return (${orderShiftSource[0]})`)(settlementState,value=>String(value||'').toLowerCase().replace(/ё/g,'е').trim(),payrollShiftKey);
  const settlement = new Function('state', 'num', 'String', 'norm', 'iso', 'parseDate', 'shiftSettlementDate', 'payrollShiftKey', 'orderPayrollShift', `return (${settlementSource[0]})`)(
    settlementState, value => Number(value) || 0, String, value => String(value || '').toLowerCase(),
    value => typeof value === 'string' ? value.slice(0, 10) : '', value => value,
    row => row._cashClosedOn || (row._cashClosedAt ? row._cashClosedAt.slice(0,10) : '') || row.closeDate || row.callDate,
    payrollShiftKey,orderPayrollShift
  );
  const sergey = { id: 'sergey', name: 'Сергей', shift: 'sergey' }, artem={id:'artem',name:'Артём',shift:'artem'};
  assert.deepEqual(settlement('2026-10-11', artem).map(r=>r.orderId), ['artem-owner-sergey-metadata'], 'dispatcher ownership wins over mismatched legacy shift metadata and actual closer');
  const sergeyIds=['sergey-order-closed-by-artem','sergey-same-day-closed-by-artem','sergey-order-closed-by-sergey'];
  assert.deepEqual(settlement('2026-10-11', sergey).map(r => r.orderId), sergeyIds);
  assert.deepEqual(settlement('2026-10-10', sergey), [], 'a future surrender cannot affect an earlier shift');
  assert.deepEqual(settlement('2026-10-12', sergey,new Set(sergeyIds)), [], 'unconfirmed chronological drafts reserve earlier cash');
  settlementState.shiftReports.push({ approvedFor: 'sergey', date: '2026-10-11', paidOrderIds: sergeyIds });
  assert.deepEqual(settlement('2026-10-12', sergey), [], 'saved order IDs stay claimed for their responsible employee');
  assert.deepEqual(settlement('2026-10-12', artem).map(r=>r.orderId), ['artem-owner-sergey-metadata'], 'a stale claim under Sergey cannot block the correct Artem owner');
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

test('order editor permissions iterate over all form controls on every published role page', () => {
  for (const file of ['index.html','dispatcher-logistic.html','hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html']) {
    const html = read(file);
    assert.equal([...html.matchAll(/\$\$\('#orderForm input,#orderForm select,#orderForm textarea,#orderForm button'\)\.forEach/g)].length, 2, file);
    assert.doesNotMatch(html, /(?<!\$)\$\('#orderForm input,#orderForm select,#orderForm textarea,#orderForm button'\)\.forEach/, file);
  }
});

test('external inbox and API entrypoints are disconnected from beta',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html','sw.js','cloud-config.js'])assert.doesNotMatch(read(f),/src="\.\/(?:b2bhelp-inbox|website-leads-inbox)|website-leads-inbox\.js/);assert.match(read('firestore.rules'),/b2bLeads\/{leadId} \{\s*allow read, write: if false;/);assert.doesNotMatch(read('chinilkin/index.html'),/remontcompsbp\.ru\/api\/website-leads|fonts\.googleapis\.com/) });test('published preview matches the audited disconnected build',()=>{for(const f of ['index.html','dispatcher-logistic.html','master.html']){const h=read('preview/v18.17.21/'+f);assert.match(h,/18\.17\.21-CANDIDATE/);assert.match(h,/premium-v181721\.css/);assert.doesNotMatch(h,/src="\.\/(?:b2bhelp-inbox|website-leads-inbox)|script\.google\.com|integrationDiag|MASTER_AI_OPEN_ORDER_FROM_(?:B2B|WEBSITE)|__MASTER_AI_PENDING_(?:B2B|WEBSITE)_LINK|Integrator v18/)}assert.match(read('preview/v18.17.21/sw.js'),/shell-v71/);assert.doesNotMatch(read('preview/v18.17.21/sw.js'),/b2bhelp|website-leads/)});test('EliteService is the visible brand across role pages and install manifests',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html']){const html=read(page);assert.match(html,/<title>EliteService<\/title>/);assert.match(html,/<h1>EliteService<\/h1>/);assert.doesNotMatch(html,/<title>MASTER AI<\/title>|<h1>MASTER AI<\/h1>/)}for(const file of ['manifest.json','manifest-dispatcher-logistic.json','manifest-master.json']){const manifest=JSON.parse(read(file));assert.match(manifest.name,/EliteService/)}assert.match(read('icon.svg'),/>?$/)});
test('owner and dispatcher Firestore sessions expose live sync health and retry failed listeners',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html'])for(const file of [page,'preview/v18.17.21/'+page]){const html=read(file);assert.match(html,/cloud\.subscribe=\(profile,onRows,retrying=false\)/);assert.match(html,/includeMetadataChanges:true/);assert.match(html,/cloud\.syncRetryTimer=setTimeout/);assert.match(html,/cloud\.subscribe\(profile,onRows,true\)/);assert.match(html,/Общая очередь диспетчеров:/);assert.match(html,/ownerSyncState/);assert.doesNotMatch(html,/Онлайн · изменения синхронизируются/);assert.match(html,/updateViaCache:'none'/);assert.match(html,/reg\.update\(\)/)}assert.match(read('sw.js'),/shell-v59/);assert.match(read('preview/v18.17.21/sw.js'),/shell-v71/)});
 test('orders use Saint Petersburg as the fixed city and have no district workflow',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html'])for(const file of [page,'preview/v18.17.21/'+page]){const html=read(file);assert.ok(html.includes('cities:[\"СПб\"]')); assert.match(html,/id=\"f_city\"[^>]*value=\"СПб\" readonly/);assert.doesNotMatch(html,/Район|cityFilter|Выручка по районам/)}});
test('orders can be filtered by visit date today without replacing other filters',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html'])for(const file of [page,'preview/v18.17.21/'+page]){const html=read(file);assert.match(html,/id=\"todayOrdersFilter\"/);assert.match(html,/iso\(parseDate\(r\.visitDate\)\)===day/)}});
test('orders can be filtered by visit date tomorrow with an exclusive quick filter',()=>{for(const page of ['index.html','dispatcher-logistic.html','master.html']){const html=read(page);assert.match(html,/id="tomorrowOrdersFilter"/);assert.match(html,/targetDate\.setDate\(targetDate\.getDate\(\)\+1\)/);assert.match(html,/setVisitDateFilter\('tomorrowOrdersFilter','todayOrdersFilter'\)/)}});
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

test('dispatcher header exposes only the saved order total in desktop and mobile lists',()=>{const html=read('hosted-snapshot/dispatcher-logistic.html');assert.match(html,/function dispatcherTotalChip\(r\).*currentRole\(\)==='dispatcher_logistic'.*money\(total\)/);assert.match(html,/order-id.*dispatcherTotalChip\(r\)/);assert.match(html,/mobile-order-id.*dispatcherTotalChip\(r\)/);assert.match(html,/dispatcher_logistic:\{label:'Диспетчер‑логист'.*money:false/)});

test('CRM calendar serialization preserves Moscow local shift dates across UTC midnight',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const html=read(file),match=html.match(/const iso=d=>[^\n]+/);assert.ok(match);assert.match(match[0],/d\.getFullYear\(\).*d\.getMonth\(\).*d\.getDate\(\)/);assert.doesNotMatch(match[0],/toISOString/)}const FakeDate=class{valueOf(){return 1}getFullYear(){return 2026}getMonth(){return 9}getDate(){return 19}toISOString(){return '2026-10-18T21:00:00.000Z'}};const iso=new Function('Date','clean',`return (${read('hosted-snapshot/index.html').match(/const iso=d=>([^\n]+)/)[0].replace(/^const iso=/,'').replace(/;\r?$/,'')})`)(FakeDate,String);assert.equal(iso(new FakeDate()),'2026-10-19')});

test('REG.RU service-worker shell refreshes after owner import and order-intake updates',()=>{assert.match(read('hosted-snapshot/sw.js'),/eliteservice-18\.17\.40-shell-v37/);assert.match(read('hosted-snapshot/sw.js'),/dispatcher-logistic\.html/);assert.match(read('hosted-snapshot/sw.js'),/master\.html/)});

test('REG.RU owner import normalizes Google Sheets headers and RGB styles and awaits shared writes',()=>{
  const owner=read('hosted-snapshot/index.html');
  const dispatcher=read('hosted-snapshot/dispatcher-logistic.html');
  assert.match(owner,/function normalizeImportHeaders\(raw\)/);
  assert.match(owner,/\['4285F4','4A86E8'\]/);
  assert.match(owner,/\['B7B7B7','CCCCCC','D9D9D9'\]/);
  assert.match(owner,/cloud\.syncOrdersNow=async/);
  assert.match(owner,/await cloud\.syncOrdersNow\(syncTargets,'owner'\)/);
  assert.match(owner,/Общая CRM подтвердила запись/);
  assert.match(owner,/Импортировать в общую CRM/);
  assert.match(owner,/disabled=!meaningful\.length\|\|currentUser\(\)\.role!=='owner'\|\|ownerRolePreview\(\)/);
  assert.match(dispatcher,/const headers=normalizeImportHeaders\(matrix\[hi\]\)/);
  assert.match(dispatcher,/Импорт в общую CRM выполняет владелец/);
  assert.match(dispatcher,/Импорт выполняет владелец/);
});

test('REG.RU order intake groups the fast-entry fields for every role without changing access gates',()=>{
  for(const page of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){
    const html=read(page),start=html.indexOf('<div class="order-intake span6"'),end=html.indexOf('<div class="form-section status-section">',start);
    assert.ok(start>=0&&end>start,`${page}: primary order intake block exists before secondary controls`);
    const intake=html.slice(start,end);
    const fields=['f_name','f_phone','f_callDate','f_callTime','f_visitDate','f_visitTime','f_address','f_request'];
    const positions=fields.map(id=>intake.indexOf(`id="${id}"`));
    assert.ok(positions.every(pos=>pos>=0),`${page}: all primary fields remain in the shared intake block`);
    assert.deepEqual(positions,[...positions].sort((a,b)=>a-b),`${page}: keyboard sequence stays predictable`);
    for(const id of fields)assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${page}: ${id} remains unique`);
    assert.match(html,/const newOrder=\(\)=>\{if\(!can\('create'\)\)/,`${page}: existing role permission gate remains in place`);
    assert.match(html,/order-intake\{grid-column:1\/-1;display:grid/);
    assert.match(html,/@media\(max-width:480px\)\{\.order-intake/);
  }
  assert.match(read('hosted-snapshot/index.html'),/if\(isStaffOrderLocked\(r\)\)\$\('#cancelEdit'\)\?\.focus\(\);else\{\$\('#f_name'\)\?\.focus\(\)\}/);
  for(const page of ['hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html'])assert.match(read(page),/setTimeout\(\(\)=>\{\$\('#f_name'\)\?\.focus\(\)\}/);
});


test('REG.RU order create waits for one server-confirmed write on owner and dispatcher',()=>{
  const owner=read('hosted-snapshot/index.html'),dispatcher=read('hosted-snapshot/dispatcher-logistic.html');
  for(const html of [owner,dispatcher]){
    assert.match(html,/cloud\.saveOrderConfirmed=async\(order,role\)=>/);
    assert.match(html,/await upsertOne\(order,role\)/);
    assert.match(html,/cloud\.versions\.set\(String\(order\.orderId/);
    assert.match(html,/Заказ не сохранён в общей базе/);
    assert.match(html,/Заказ сохранён в общей базе/);
  }
  assert.match(owner,/SECURE_CLOUD_REQUIRED=!!window\.MASTER_AI_BETA_ONLINE/);
  assert.match(dispatcher,/SECURE_CLOUD_REQUIRED=!!window\.MASTER_AI_BETA_ONLINE&&!!FORCED_APP_ROLE/);
  assert.match(read('hosted-snapshot/master.html'),/const newOrder=\(\)=>\{if\(!can\('create'\)\)/);
});


test('confirmed payroll remains saved while mismatches show a live preliminary reconciliation',()=>{const html=read('hosted-snapshot/index.html');assert.ok(html.includes('.filter(r=>!r.closureOnly&&(shiftIntegrity(r)||(r.ownerConfirmed&&r.subjectMemberId)))'));assert.ok(html.includes('frozen=!!(report&&verified)'));assert.ok(html.includes('reported:report?num(report.salary):null'));assert.ok(html.includes("x.reportStatus==='check'?' · сохранено '+money(x.reported)"));assert.ok(html.includes('if(existing&&(shiftIntegrity(existing)||(existing.ownerConfirmed&&existing.subjectMemberId))){skipped++;continue}'));assert.ok(html.includes('savedReports.filter(r=>r.ownerConfirmed&&r.subjectMemberId&&!r.closureOnly)'));});

test('owner shift history shows recalculated cash for changed reports without overwriting the saved snapshot',()=>{const html=read('hosted-snapshot/index.html');assert.ok(html.includes("recalc=role==='owner'&&!r.closureOnly&&!verified?((window.__ownerShiftDrafts||{})[r.id]||Object.values(window.__ownerShiftDrafts||{}).find(d=>d.date===r.date&&payrollShiftKey(d)===payrollShiftKey(r))):null"));assert.ok(html.includes('shownCash=recalc?.shiftCash??r.shiftCash??r.cash'));assert.ok(html.includes('shownDeferred=recalc?.deferredCash??r.deferredCash??0'));assert.ok(html.includes('shownSalary=recalc?.salary??r.salary'));assert.ok(html.includes('Предварительная сверка по текущим заказам; сохранённый отчёт не изменён.'));});
test('shift report history sorts by shift date so a newer closed shift is visible',()=>{const html=read('hosted-snapshot/index.html');assert.ok(html.includes("String(b.date||b.closedAt||'').localeCompare(String(a.date||a.closedAt||''))"));assert.ok(html.includes("String(b.closedAt||'').localeCompare(String(a.closedAt||''))"));});

test('REG.RU green completed orders count as surrendered cash exactly once', () => {
  const source = read('hosted-snapshot/index.html');
  const cashRule = source.match(/function payrollOrderCashRecorded\(r\)\{[^\n]+?\}/);
  assert.ok(cashRule, 'cash reconciliation rule exists');
  const isCashRecorded = new Function('num', 'derivedStage', 'parseDate', `return (${cashRule[0]})`)(
    value => Number(value) || 0,
    row => row._status || '',
    value => !!value
  );
  assert.equal(isCashRecorded({ _status: 'Выполнен', companyShare: 1500 }), true);
  assert.equal(isCashRecorded({ _status: 'В работе', companyShare: 1500 }), false);
  assert.equal(isCashRecorded({ _status: 'Выполнен', companyShare: 0 }), false);

  const settlementSource = source.match(/function shiftSettlementOrders\([^\n]+/);
  assert.ok(settlementSource, 'cash settlement source exists');
  const state = { shiftReports: [], orders: [
    { orderId: 'green-complete', _createdByShift: 'sergey', _status: 'Выполнен', callDate: '2026-10-11', companyShare: 5500 },
    { orderId: 'still-open', _createdByShift: 'sergey', _status: 'В работе', callDate: '2026-10-11', companyShare: 7000 },
    { orderId: 'no-company-cash', _createdByShift: 'sergey', _status: 'Выполнен', callDate: '2026-10-11', companyShare: 0 }
  ] };
  const ownerShiftSource = source.match(/function payrollShiftKey\([\s\S]*?\n(?=function )/);
  assert.ok(ownerShiftSource, 'payroll shift normalization exists');
  const orderOwnerSource = source.match(/function orderPayrollShift\([\s\S]*?\n(?=function )/);
  assert.ok(orderOwnerSource, 'order payroll owner resolver exists');
  const resolveShift = new Function('state', 'norm', 'String', `${ownerShiftSource[0]}; ${orderOwnerSource[0]}; return { payrollShiftKey: payrollShiftKey, orderPayrollShift: orderPayrollShift }`)(
    state, value => String(value || '').trim().toLowerCase(), String
  );
  const settlement = new Function('state', 'num', 'String', 'norm', 'iso', 'parseDate', 'derivedStage', 'shiftOrderDate', 'shiftSettlementDate', 'payrollShiftKey', 'orderPayrollShift', `return (${settlementSource[0]})`)(
    state, value => Number(value) || 0, String, value => String(value || '').toLowerCase(),
    value => value ? String(value).slice(0, 10) : '', value => value || null,
    row => row._status || '', row => row.callDate, row => row._cashClosedOn || row._cashClosedAt?.slice(0,10) || row.closeDate || row.callDate,
    resolveShift.payrollShiftKey, resolveShift.orderPayrollShift
  );
  const profile = { id: 'sergey', name: 'Сергей', shift: 'sergey' };
  assert.deepEqual(settlement('2026-10-11', profile).map(row => row.orderId), ['green-complete']);
  state.shiftReports.push({ approvedFor: 'sergey', date: '2026-10-11', paidOrderIds: ['green-complete'] });
  assert.deepEqual(settlement('2026-10-12', profile), [], 'paid order IDs cannot be counted twice');
});

test('payroll follows visit date and accepts a table surrender date without a year', () => {
  const source = read('hosted-snapshot/index.html');
  const orderDateSource = source.match(/function shiftOrderDate\(r\)\{[^\n]+\}/);
  const recordedDateSource = source.match(/function shiftCashRecordedDate\(r\)\{[^\n]+\}/);
  const settlementDateSource = source.match(/function shiftSettlementDate\(r\)\{[^\n]+\}/);
  assert.ok(orderDateSource && recordedDateSource && settlementDateSource, 'payroll date resolvers exist');
  const parseDate = value => {
    if (!value) return null;
    const text = String(value).trim();
    let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return null;
  };
  const iso = date => date ? date.toISOString().slice(0, 10) : '';
  const clean = value => String(value || '').trim();
  const orderDate = new Function('iso', 'parseDate', `return (${orderDateSource[0]})`)(iso, parseDate);
  const recordedDate = new Function('iso', 'parseDate', 'clean', 'Date', `return (${recordedDateSource[0]})`)(iso, parseDate, clean, Date);
  const settlementDate = new Function('shiftCashRecordedDate', 'shiftOrderDate', `return (${settlementDateSource[0]})`)(recordedDate, orderDate);
  const order = { callDate: '2026-10-16', visitDate: '2026-10-19', closeDate: '19.10' };
  assert.equal(orderDate(order), '2026-10-19', 'work belongs to the visit day');
  assert.equal(recordedDate(order), '2026-10-19', 'a dd.mm surrender date uses the order year');
  assert.equal(settlementDate(order), '2026-10-19', 'settlement uses the recorded date');
  assert.equal(recordedDate({ closeDate: '19.10.2026', _cashClosedOn: '2026-10-20', _cashClosedAt: '2026-10-20T00:55:00+03:00' }), '2026-10-19', 'explicit surrender date takes precedence over a post-midnight technical close timestamp');
  assert.ok(source.includes('cashDate=shiftCashRecordedDate(r)'), 'shift cards display the source surrender date');
});
test('owner closed-shift register groups surrendered orders by responsible dispatcher and 2-day cycle',()=>{const h=read('hosted-snapshot/index.html'),d=read('hosted-snapshot/dispatcher-logistic.html');assert.match(h,/data-tab=\"payrollcycles\">Закрытые смены/);assert.match(h,/data-panel=\"payrollcycles\"/);assert.match(h,/tabs:\['orders','dashboard','performance','mastershifts','shiftclose','payrollcycles'/);assert.doesNotMatch(d,/data-panel=\"payrollcycles\"/);const start=h.indexOf('function renderPayrollCycleRegister(){'),end=h.indexOf('function renderWeeklyReports(){',start),fn=h.slice(start,end);assert.ok(start>=0&&end>start);assert.match(fn,/orderPayrollShift\(r\)===who/);assert.match(fn,/shiftCashRecordedDate\(r\)/);assert.match(fn,/accounted\.get\(who\+/);assert.match(fn,/String\(r\.orderId\)/);assert.match(fn,/shiftPayroll\(cash\)/);assert.match(fn,/currentReport\(report\)\?num\(report\.salary\):shiftPayroll\(cash\)/);assert.match(fn,/saved=historic\.every\(currentReport\)/);assert.match(fn,/settlementStartDate\.getDate\(\)-2/);assert.match(fn,/cycleReportIds/);assert.match(fn,/Без даты сдачи · /);assert.match(fn,/Уже учтён/);assert.match(fn,/без даты сдачи/);assert.match(fn,/\$\$\('\[data-owner-shift-order\]'\)/)});
test('payroll finance includes owner-confirmed reports and excludes closure-only records',()=>{const h=read('hosted-snapshot/index.html');assert.match(h,/state\.shiftReports\.filter\(r=>!r\.closureOnly/);assert.match(h,/r=>shiftIntegrity\(r\)\|\|\(r\.ownerConfirmed&&r\.subjectMemberId\)/)});

test('closed-shift register uses compact single-line order chips, more viewport height, and no footer on all live roles',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file),css=h.split('<style id="closed-shift-density-v1">')[1]?.split('</style>')[0]||'';assert.ok(css);assert.ok(css.includes('nth-child(7),.payroll-daily-wrap .payroll-cycle-register-table td:nth-child(7){width:29%}'));assert.ok(css.includes('max-height:calc(100vh - 300px)'));assert.ok(css.includes('max-height:min(40vh,340px)'));assert.ok(css.includes('white-space:nowrap'));assert.ok(!h.includes('<div class="footer">EliteService · Онлайн CRM</div>'));assert.ok(h.includes("window.MASTER_AI_BUILD='18.17.40-REG-RU-RENDER-RECOVERY'"))}});
test('closed-shift register keeps order details in compact readable fields without horizontal scrolling',()=>{const h=read('hosted-snapshot/index.html');assert.match(h,/payroll-cycle-register-table\{width:100%;min-width:0;table-layout:fixed/);assert.match(h,/payroll-cycle-order\{display:grid/);assert.match(h,/payroll-cycle-register-table td:nth-child\(7\):before/);assert.match(h,/cycles\.reverse\(\)/)});
test('all role pages share the high-contrast palette, readable typography, and truthful database badge colors',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file);assert.ok(h.includes('id="crm-clarity-audit-refresh"'));assert.ok(h.includes('.tab.active{background:linear-gradient(135deg,#1769e0,#0d4fb7)'));assert.ok(h.includes('.table td{font-size:13px'));assert.ok(h.includes('db-status-error'));assert.ok(h.includes('db-status-online'));assert.ok(h.includes("window.MASTER_AI_BUILD='18.17.40-REG-RU-RENDER-RECOVERY'"))}});
test('order cards show dispatcher separately and include the complete finance group on every role page',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file);assert.match(h,/class="team-master-field"/);assert.match(h,/class="team-dispatcher-field"><span>Диспетчер<\/span><b>\$\{esc\(r\.dispatcher\|\|'—'\)\}<\/b>/);assert.match(h,/<span>Мастеру<\/span><b>\$\{numMaybe\(r\.masterAmount\)/);assert.match(h,/<span>Сдача заявки<\/span><b>\$\{esc\(r\.closeDate/);assert.match(h,/id="order-role-column-clarity"/);assert.match(h,/thead th:nth-child\(11\).*thead th:nth-child\(12\)/s);assert.match(h,/mobile-order-meta \.team-master-field\{background:#eaf2ff/);assert.match(h,/mobile-order-meta \.team-dispatcher-field\{background:#f1eaff/)}});
test('late payroll queue separates pending closure, late cash awaiting reconciliation, and already accounted orders',()=>{
  const html=read('hosted-snapshot/index.html'),start=html.indexOf('function renderLatePayrollQueue('),end=html.indexOf('\nfunction renderDailyPayrollReconciliation(',start);assert.ok(start>=0&&end>start);
  const parseDate=v=>{const m=String(v||'').match(/^(\d{4})-(\d\d)-(\d\d)/);return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):null},iso=d=>d?d.toISOString().slice(0,10):'';
  const state={settings:{staff:[{id:'s',name:'Сергей',role:'dispatcher_logistic',shift:'sergey'},{id:'a',name:'Артём',role:'dispatcher_logistic',shift:'artem'}]},orders:[
    {orderId:'LATE',dispatcher:'Сергей',callDate:'2026-10-15',visitDate:'2026-10-22',_status:'Выполнен',closeDate:'2026-10-19',companyShare:6000},
    {orderId:'OPEN',dispatcher:'Сергей',visitDate:'2026-10-15',_status:'В работе',companyShare:0},
    {orderId:'ONTIME',dispatcher:'Сергей',visitDate:'2026-10-15',_status:'Выполнен',closeDate:'2026-10-16',companyShare:3000},
    {orderId:'USED',dispatcher:'Сергей',visitDate:'2026-10-15',_status:'Выполнен',closeDate:'2026-10-19',companyShare:4000},
    {orderId:'ARTEM-LATE',dispatcher:'Артём',callDate:'2026-10-17',visitDate:'2026-10-24',_status:'Выполнен',closeDate:'2026-10-20',companyShare:5000}
  ],shiftReports:[{id:'2026-10-19-sergey',date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['USED']},{id:'2026-10-19-artem',date:'2026-10-19',shift:'artem',ownerConfirmed:true,subjectMemberId:'a',paidOrderIds:['LATE']}]};
  const box={innerHTML:'',hidden:false},elements={'#latePayrollQueue':box};const fn=new Function('state','$','currentUser','today','uniqueShiftReports','payrollShiftKey','shiftIntegrity','orderPayrollShift','shiftOrderDate','derivedStage','payrollScheduledShift','iso','payrollOrderCashRecorded','shiftCashRecordedDate','parseDate','num','money','esc',html.slice(start,end)+';return renderLatePayrollQueue')(
    state,s=>elements[s],()=>({role:'owner'}),()=> '2026-10-20',rows=>rows,
    r=>String(r.shift||'').toLowerCase(),()=>true,
    r=>r.dispatcher==='Сергей'?'sergey':r.dispatcher==='Артём'?'artem':'',
    r=>r.visitDate, r=>r._status,(date,anchor,first)=>{const d=parseDate(date),a=parseDate(anchor),n=Math.floor((d-a)/86400000),phase=((n%4)+4)%4;return phase<2?first:first==='sergey'?'artem':'sergey'},iso,
    r=>['Выполнен','Закрыт','Закрыто'].includes(r._status)&&Number(r.companyShare)>0,r=>r.closeDate||'',parseDate,v=>Number(v)||0,v=>`${Number(v).toFixed(0)} ₽`,v=>String(v));
  fn('2026-10-15','sergey');
  assert.match(box.innerHTML,/LATE/);assert.match(box.innerHTML,/OPEN/);assert.match(box.innerHTML,/USED/);assert.match(box.innerHTML,/ARTEM-LATE/);assert.match(box.innerHTML,/2 закрытых заказов на 11000 ₽/);assert.doesNotMatch(box.innerHTML,/ONTIME/);
  assert.match(box.innerHTML,/Готово к сверке/);assert.match(box.innerHTML,/Ожидает закрытия/);assert.match(box.innerHTML,/Учтено в отчёте за 2026-10-19/);assert.ok(html.includes('if(valid){reservedByOwner.set(ownerKey,new Set([...reserved,...(Array.isArray(existing.paidOrderIds)?existing.paidOrderIds:[]).map(String)]))}'),'confirmed order IDs are reserved before later shift drafts');
  const nonOwner=new Function('state','$','currentUser',html.slice(start,end)+';return renderLatePayrollQueue')(state,s=>elements[s],()=>({role:'dispatcher_logistic'}));nonOwner('2026-10-15','sergey');assert.equal(box.hidden,true);
});

test('order role and finance fields use aligned low-contrast rounded surfaces on every published role page',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file);assert.match(h,/id="order-field-polish"/);assert.match(h,/table tbody tr td:nth-child\(11\).*box-shadow:none!important/s);assert.match(h,/mobile-order-meta>div\{box-sizing:border-box;min-width:0;min-height:58px;display:flex;flex-direction:column;justify-content:center/);assert.match(h,/mobile-order-meta \.finance-col\{background:linear-gradient/);assert.match(h,/mobile-order-meta \.team-dispatcher-field\{background:linear-gradient/)} });
test('desktop order role, cash, amount, and surrender date use consistent rounded value chips on every role page',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file);assert.match(h,/id="order-field-polish"/);assert.match(h,/class="order-value-chip order-dispatcher-chip">\$\{esc\(r\.dispatcher\|\|'—'\)\}/);assert.match(h,/class="order-value-chip order-money-chip">\$\{numMaybe\(r\.total\)/);assert.match(h,/class="order-value-chip order-money-chip order-cash-chip">\$\{numMaybe\(r\.companyShare\)/);assert.match(h,/class="order-value-chip order-close-date-chip">\$\{esc\(r\.closeDate/);assert.match(h,/table tbody tr td:nth-child\(11\).*box-shadow:none!important/s);assert.match(h,/\.order-value-chip\{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;min-height:34px/);assert.match(h,/\.order-dispatcher-chip\{justify-content:flex-start;text-align:left/);assert.match(h,/\.order-cash-chip\{background:#edf6ef/);assert.match(h,/inline-master-input\{box-sizing:border-box;width:100%;min-width:0;min-height:34px/);assert.match(h,/mobile-order-meta \.team-dispatcher-field\{background:linear-gradient/)}});
test('desktop owner and finance columns have no full-height divider strips and use individual rounded surfaces',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file);const polished=h.split('<style id="order-field-polish">')[1]?.split('</style>')[0]||'';assert.match(polished,/nth-child\(11\),\.orders-table-wrap \.table thead th:nth-child\(12\).*border:0!important;border-radius:9px/s);assert.match(polished,/tbody tr td:nth-child\(11\).*border-left:0!important;border-right:0!important/s);assert.doesNotMatch(polished,/box-shadow:inset 0 0 0 999px/);assert.match(polished,/table tbody tr td:nth-child\(11\).*box-shadow:none!important;border-left:0!important/s);assert.doesNotMatch(polished,/tbody tr td:nth-child\(11\).*background:transparent!important/);assert.match(h,/\.table tbody tr\.status-green td\{background:#dcf2e4!important/);assert.match(polished,/\.order-value-chip\{[^}]*border:1px solid[^}]*border-radius:9px/);assert.match(h,/window\.MASTER_AI_BUILD='18\.17\.40-REG-RU-RENDER-RECOVERY'/)}});

test('order list uses one palette for ID and roles, coordinated finance styling, and wider compact desktop layout',()=>{for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){const h=read(file);const css=h.split('<style id="order-table-compact-palette">')[1]?.split('</style>')[0]||'';assert.ok(css);assert.match(css,/\.app\{width:100%;max-width:1920px/);assert.match(css,/nth-child\(2\).*nth-child\(11\).*nth-child\(12\).*background:#eaf0f8/);assert.match(css,/nth-child\(13\).*nth-child\(14\).*nth-child\(15\).*nth-child\(16\).*background:#eaf3ec/);assert.match(css,/min-height:28px/);assert.match(css,/@media\(min-width:1300px\).*mobile-order-list\{display:none/s);assert.match(css,/@media\(max-width:1299px\)/);assert.doesNotMatch(css,/border-left:[2-9]px solid/)}assert.match(read('hosted-snapshot/sw.js'),/eliteservice-18\.17\.40-shell-v37/) });

test('today controls bind without aborting login and weekly rows use their own shift values',()=>{
  for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){
    const html=read(file),today=html.match(/function renderToday\(\)[\s\S]*?\nfunction /)?.[0]||'';
    assert.match(today,/\$\$\('\[data-today\]'\)\.forEach/);
    assert.match(today,/\$\$\('\[data-today-status\]'\)\.forEach/);
assert.doesNotMatch(today,/(?<!\$)\$\('\[data-today(?:-status)?\]'\)\.forEach/);
    assert.match(html,/window\.MASTER_AI_BUILD='18\.17\.40-REG-RU-RENDER-RECOVERY'/);
  }
  const owner=read('hosted-snapshot/index.html'),weekly=owner.match(/function renderWeeklyReports\(\)[\s\S]*?\nfunction /)?.[0]||'';
  assert.match(weekly,/money\(r\.deferredCash\?\?0\)/);
  assert.match(weekly,/money\(r\.salary\?\?0\)/);
  assert.doesNotMatch(weekly,/money\(shown(?:Deferred|Salary)\)/);
  assert.match(read('hosted-snapshot/sw.js'),/eliteservice-18\.17\.40-shell-v37/);
});
test('today cash separates orders received today from all recorded cash closed today on all roles',()=>{
  for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){
    const html=read(file);
    assert.match(html,/function hasRecordedCashSurrenderOn\(r,date\).*shiftCashRecordedDate\(r\)===date&&num\(r\.companyShare\)>0/s);
    assert.match(html,/newCashToday=cashToday\.filter\(r=>iso\(parseDate\(r\.callDate\)\)===d\)/);
    assert.match(html,/data-today="cash-new"/);
    assert.match(html,/data-today="cash-total"/);
    assert.match(html,/today_cash_new/);
    assert.match(html,/today_cash_total/);
    assert.match(html,/Касса сегодня/);
    assert.match(html,/Общая касса сегодня/);
    assert.match(html,/<style id="today-cash-split-v1">#todayBox \.money-preview\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important\}<\/style>/);
    assert.match(html,/window\.MASTER_AI_BUILD='18\.17\.40-REG-RU-RENDER-RECOVERY'/);
  }
  assert.match(read('hosted-snapshot/sw.js'),/eliteservice-18\.17\.40-shell-v37/);
});

test('order status and today dashboards stay compact, readable, and free of explanatory copy on all roles',()=>{
  for(const file of ['hosted-snapshot/index.html','hosted-snapshot/dispatcher-logistic.html','hosted-snapshot/master.html']){
    const html=read(file),css=html.split('<style id="orders-workspace-density-v2">')[1]?.split('</style>')[0]||'';
    assert.ok(css,`${file} has order dashboard styles`);
    assert.match(css,/\.app\{width:100%;max-width:1920px/);
    assert.match(css,/\.tab\{min-height:38px[^}]*font-size:13px/);
    assert.match(css,/\.orders-toolbar\{display:grid;grid-template-columns:[^}]*;[^}]*flex:1/);
    assert.match(css,/\.orders-toolbar \.input,\.orders-toolbar \.select,\.orders-toolbar \.btn\{[^}]*min-height:38px[^}]*font-size:12px/);
    assert.match(css,/\.orders-table-wrap\{max-height:calc\(100vh - 195px\);min-height:320px/);
    assert.match(css,/\.orders-table-wrap \.table tbody td\{padding:4px 3px;font-size:11\.5px/);
    assert.match(css,/\.color-audit\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
    assert.match(css,/\.color-audit-item \.filter-hint\{display:none!important\}/);
    assert.match(css,/@media\(max-width:600px\)/);
    assert.match(html,/id="colorAudit"/);assert.match(html,/id="todayBox"/);
    assert.match(html,/Заказы по статусам/);assert.match(html,/Сегодня/);
    assert.doesNotMatch(html,/Рабочая очередь заказов|Шесть рабочих цветов|Карточки ниже кликабельны|Оперативные показатели без перехода/);
    assert.match(html,/if\(\$\('#newOrderInline'\)\)\$\('#newOrderInline'\)\.onclick=newOrder/);
    assert.match(html,/if\(\$\('#newOrderInline'\)\)\$\('#newOrderInline'\)\.hidden=!/);
  }
  assert.match(read('hosted-snapshot/sw.js'),/eliteservice-18\.17\.40-shell-v37/);
});
