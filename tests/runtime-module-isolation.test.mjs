import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../hosted-snapshot/', import.meta.url);
const roles = ['index.html', 'dispatcher-logistic.html', 'master.html'];
const renderers = ['refillFilters', 'renderDrillBanner', 'renderOrders', 'renderDashboard',
  'renderPerformance', 'renderShiftClose', 'renderPayrollCycleRegister', 'renderMasterShifts',
  'renderTeamPerformance', 'renderShiftReports', 'renderQuality', 'renderAI', 'renderFinance',
  'renderSettings', 'renderSchema', 'renderColorAudit'];

function refreshHarness(role, {tab = 'orders', failing = ''} = {}) {
  const html = fs.readFileSync(new URL(role, root), 'utf8');
  const source = html.split(/\r?\n/).find(line => line.startsWith('function refresh(){'));
  assert.ok(source, role + ': generated refresh entrypoint exists');
  const calls = [], errors = [];
  const context = {
    console: {error: (...args) => errors.push(args)},
    $: () => ({dataset: {tab}}),
    filterRows: () => [],
    refreshLiveQuality() {
      calls.push('qualityMonitor');
      if (failing === 'qualityMonitor') throw new Error('Injected optional monitor failure');
    },
  };
  for (const name of renderers) context[name] = () => {
    calls.push(name);
    if (name === failing) throw new Error('Injected ' + name + ' failure');
  };
  vm.runInNewContext(source + '\nrefresh();', context);
  return {calls, errors};
}

for (const role of roles) {
  test(role + ': failed optional loading is visible and does not prevent a subsequent feature', async () => {
    const html = fs.readFileSync(new URL(role, root), 'utf8');
    const source = html.split(/\r?\n/).find(line => line.startsWith('async function loadOptionalFeature('));
    assert.ok(source);
    const notices = [], errors = [];
    const context = {console: {error: (...args) => errors.push(args)}, document: {
      createElement: () => ({setAttribute(){}}),
      querySelector: () => ({prepend: notice => notices.push(notice.textContent)}),
    }};
    vm.runInNewContext(source, context);
    const result = await context.loadOptionalFeature('Контроль данных', async () => {throw new Error('Injected missing module');});
    assert.equal(result, null);
    assert.equal(errors.length, 1);
    assert.match(notices[0], /Контроль данных.*не загрузился/);
    assert.equal(await context.loadOptionalFeature('Другой модуль', async () => 42), 42);
    assert.equal(notices.length, 1);
  });

  test(role + ': optional quality monitor failure does not prevent order refresh', () => {
    const {calls, errors} = refreshHarness(role, {failing: 'qualityMonitor'});
    assert.ok(calls.includes('refillFilters'));
    assert.ok(calls.includes('renderOrders'));
    assert.equal(errors.length, 1, 'failure must remain observable');
  });

  test(role + ': one renderer failure does not cancel the remaining queued renderer', () => {
    const {calls, errors} = refreshHarness(role, {tab: 'mastershifts', failing: 'renderMasterShifts'});
    assert.ok(calls.includes('renderTeamPerformance'));
    assert.equal(errors.length, 1);
  });

  test(role + ': inactive financial sections are not rendered by an order update', () => {
    const {calls, errors} = refreshHarness(role);
    assert.ok(calls.includes('renderOrders'));
    assert.ok(!calls.includes('renderFinance'));
    assert.ok(!calls.includes('renderPayrollCycleRegister'));
    assert.deepEqual(errors, []);
  });
}

test('accounting and data-quality calculation run without DOM, network, Telegram or shared CRM state', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(new URL('profit-accounting.js', root), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(new URL('quality-monitor.js', root), 'utf8'), context);
  const input = {
    from: '2026-11-01', to: '2026-11-01',
    orders: [{id: 'single', date: '2026-11-01', closed: true, cash: 25000}],
    salaries: [{date: '2026-11-01', person: 'sergey', amount: 2500, confirmed: true}],
    expenses: [{date: '2026-11-01', amountCents: 100000, category: 'Реклама'}],
  };
  const before = JSON.stringify(input);
  assert.equal(context.ProfitAccounting.calculate(input).profit, 21500);
  const orders = [{orderId: 'single', _status: 'Выполнен', dispatcher: 'Сергей',
    callDate: '2026-11-01', closeDate: '2026-11-01', total: 30000, parts: 0,
    masterAmount: 5000, companyShare: 25000}];
  const auditBefore = JSON.stringify(orders);
  assert.equal(context.MasterAIQualityMonitor.analyze({orders}).issues.length, 0);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(orders), auditBefore);
});
