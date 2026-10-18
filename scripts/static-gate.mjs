import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');
const must = (ok, msg) => { if (!ok) throw new Error(msg); };
// Validate the exact REG.RU release candidate (not the separate GitHub Pages snapshot).
const root = 'hosted-snapshot/';
const cfg = read(root + 'cloud-config.js');
const patch = read(root + 'quota-safe-v181719.js');
const owner = read(root + 'index.html');
const dispatcher = read(root + 'dispatcher-logistic.html');
const master = read(root + 'master.html');
const state = {
  baseCurrent: '18.17.18-CURRENT', candidate: '18.17.23-REG-RU-CANDIDATE',
  environment: { firebaseProject: 'master-ai-beta-9440599', workspace: 'master-ai-beta', billing: 'Spark / NO BILLING' },
  stableEntryPoints: {
    owner: 'https://araarkadij75-oss.github.io/-/preview/v18.17.21/',
    dispatcherLogistic: 'https://araarkadij75-oss.github.io/-/preview/v18.17.21/dispatcher-logistic.html'
  },
  syncContract: { fullReconcile: 'manual_only', bridgeProtocol: 2 }
};
const manifests = [
  [root + 'manifest.json','./index.html'],
  [root + 'manifest-dispatcher-logistic.json','./dispatcher-logistic.html'],
  [root + 'manifest-master.json','./master.html']
];

const currentCfg = read('cloud-config.js');
const currentPatch = read('quota-safe-v181719.js');
must(state.baseCurrent === '18.17.18-CURRENT', 'candidate must be based on 18.17.18-CURRENT');
must(state.environment.firebaseProject === 'master-ai-beta-9440599', 'wrong Firebase project');
must(state.environment.workspace === 'master-ai-beta', 'wrong workspace');
must(state.environment.billing === 'Spark / NO BILLING', 'billing policy drift');
must(state.stableEntryPoints?.owner === 'https://araarkadij75-oss.github.io/-/preview/v18.17.21/', 'stable owner URL drift');
must(state.stableEntryPoints?.dispatcherLogistic === 'https://araarkadij75-oss.github.io/-/preview/v18.17.21/dispatcher-logistic.html', 'stable dispatcher URL drift');
must(/["']?projectId["']?\s*:\s*["']master-ai-beta-9440599["']/.test(cfg), 'cloud-config project drift');
must(/["']?workspaceId["']?\s*:\s*["']master-ai-beta["']/.test(cfg), 'cloud-config workspace drift');
must(cfg.includes("MASTER_AI_BUILD='18.17.22-REG-RU-CANDIDATE'") || cfg.includes('MASTER_AI_BUILD="18.17.22-REG-RU-CANDIDATE"'), 'candidate build drift');
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
  must(html.includes("navigator.serviceWorker.register('./sw.js'"), name + ': service worker registration missing');
  must(!/master-ai-9440599\.web\.app/.test(html), name + ': legacy PROD hosting URL leaked into executable HTML');
  if (name === 'owner') {
    must(!/\['ping','dry','read','sync'/.test(html), 'mutating diagnostic URL mode leaked');
    must(!/integrationDiag|MASTER_AI_OPEN_ORDER_FROM_(B2B|WEBSITE)|__MASTER_AI_PENDING_(B2B|WEBSITE)_LINK/.test(html), 'retired integration callback remains in owner runtime');
  }
  must(!html.includes("await window.MasterAICloud.cleanupTechnicalArtifacts?.()"), name + ': login performs an unbounded cleanup scan');
}

for (const [file, source] of [['cloud-config.js', currentCfg], ['quota-safe-v181719.js', currentPatch]]) {
  must(source.length > 0, `Current stable dependency is missing: ${file}`);
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
