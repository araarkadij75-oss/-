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
  assert.equal(s.syncContract.bridgeProtocol, 2);
  assert.equal(s.syncContract.fullReconcile, 'manual_only');
  assert.equal(s.syncContract.legacyAutoFullSyncBlocked, true);
  assert.equal(s.syncContract.focusPull, false);
  assert.equal(s.promotion.allowed, false);
});

test('18.17.18 safety patch keeps delta/delete invariants', () => {
  const p = read('quota-safe-v181718.js');
  assert.match(p, /canonicalDeleteSafety:true/);
  assert.match(p, /fullReconcileMode:'manual_only'/);
  assert.match(p, /legacyAutoFullSyncBlocked:true/);
  assert.match(p, /autoFlushOnOpen:false/);
  assert.match(p, /focusPull:false/);
  assert.match(p, /retryLimit:5/);
  assert.match(p, /bridgeProtocol:2/);
  assert.doesNotMatch(p, /\bphoneAccess\b/);
});

test('role entrypoints are pinned', () => {
  assert.match(read('dispatcher-logistic.html'), /MASTER_AI_FORCED_ROLE="dispatcher_logistic"/);
  assert.match(read('master.html'), /MASTER_AI_FORCED_ROLE="master"/);
});

test('legacy production project is absent from runtime cloud config', () => {
  const c = read('cloud-config.js');
  assert.match(c, /master-ai-beta-9440599/);
  assert.doesNotMatch(c, /projectId\s*:\s*["']master-ai-9440599["']/);
});
