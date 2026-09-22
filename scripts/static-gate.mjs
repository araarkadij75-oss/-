import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');
const must = (ok, msg) => { if (!ok) throw new Error(msg); };
const cfg = read('cloud-config.js');
const patch = read('quota-safe-v181718.js');
const owner = read('index.html');
const dispatcher = read('dispatcher-logistic.html');
const master = read('master.html');
const state = JSON.parse(read('release-state.json'));
const manifests = [
  ['manifest.json','./index.html'],
  ['manifest-dispatcher-logistic.json','./dispatcher-logistic.html'],
  ['manifest-master.json','./master.html']
];

must(state.baseCurrent === '18.17.18-CURRENT', 'candidate must be based on 18.17.18-CURRENT');
must(state.environment.firebaseProject === 'master-ai-beta-9440599', 'wrong Firebase project');
must(state.environment.workspace === 'master-ai-beta', 'wrong workspace');
must(state.environment.billing === 'Spark / NO BILLING', 'billing policy drift');
must(cfg.includes("projectId:'master-ai-beta-9440599'") || cfg.includes('projectId:"master-ai-beta-9440599"'), 'cloud-config project drift');
must(cfg.includes("workspaceId:'master-ai-beta'") || cfg.includes('workspaceId:"master-ai-beta"'), 'cloud-config workspace drift');
must(cfg.includes("MASTER_AI_BUILD='18.17.18-CURRENT'") || cfg.includes('MASTER_AI_BUILD="18.17.18-CURRENT"'), 'base build drift');
must(cfg.includes('quota-safe-v181718.js'), '18.17.18 quota-safe patch missing');
must(!/\bphoneAccess\b/.test(owner + dispatcher + master + patch), 'obsolete phoneAccess reference');
must(patch.includes("fullReconcileMode:'manual_only'"), 'full reconcile is not manual_only');
must(patch.includes('legacyAutoFullSyncBlocked:true'), 'legacy auto full sync is not blocked');
must(patch.includes('autoFlushOnOpen:false'), 'auto flush on open must stay disabled');
must(patch.includes('focusPull:false'), 'focus pull must stay disabled');
must(patch.includes('canonicalDeleteSafety:true'), 'canonical delete safety missing');
must(patch.includes('bridgeProtocol:2'), 'Bridge Protocol v2 missing');
must(dispatcher.includes('MASTER_AI_FORCED_ROLE="dispatcher_logistic"'), 'dispatcher-logistic entrypoint role drift');
must(master.includes('MASTER_AI_FORCED_ROLE="master"'), 'master entrypoint role drift');

for (const [file,start] of manifests) {
  const m = JSON.parse(read(file));
  must(m.start_url === start, file + ' start_url drift');
  must(m.display === 'standalone', file + ' must be standalone');
}

for (const [name,html] of [['owner',owner],['dispatcher',dispatcher],['master',master]]) {
  must(html.includes("if('serviceWorker' in navigator"), name + ': PWA hook missing');
  must(!/master-ai-9440599\.web\.app/.test(html), name + ': legacy PROD hosting URL leaked into executable HTML');
}

console.log('STATIC BASELINE GATE: PASS');
console.log(JSON.stringify({
  candidate: state.candidate,
  base: state.baseCurrent,
  project: state.environment.firebaseProject,
  workspace: state.environment.workspace,
  billing: state.environment.billing,
  fullReconcile: state.syncContract.fullReconcile,
  bridgeProtocol: state.syncContract.bridgeProtocol
}, null, 2));
