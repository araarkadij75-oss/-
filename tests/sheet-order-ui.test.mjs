import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../hosted-snapshot/sheet-order-ui.js', import.meta.url), 'utf8');
const orderId = '261124-001';

function node(dataset = {}) {
  return {
    dataset, children: [], setAttribute() {},
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); }
  };
}

function harness(reply) {
  const desktop = node({sheetOrder:orderId}), mobile = node({sheetOrder:orderId});
  const listeners = {}, calls = [];
  const document = {
    querySelectorAll: () => [desktop, mobile], createElement: () => node(),
    addEventListener: (name, callback) => { listeners[name] = callback; }
  };
  const window = { MasterAICloud:{connected:true, profile:{uid:'dispatcher'}, getIdToken:async () => 'mock'},
    addEventListener() {} };
  let timer;
  vm.runInNewContext(source, {document, window, Date, setTimeout: callback => {timer = callback;}, clearTimeout() {},
    fetch:async (_, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      const result = await reply(body);
      return {ok:result.ok === true, json:async () => result};
    }
  });
  return { desktop, mobile, calls,
    async render() { timer(); await new Promise(resolve => setImmediate(resolve)); },
    click(action, slot = desktop) {
      const button = {dataset:{sheetAction:action}, closest:() => slot};
      return listeners.click({target:{closest:() => button}, stopPropagation() {}});
    }
  };
}

test('desktop and mobile share one verified write, including concurrent clicks', async () => {
  let finish;
  const ui = harness(payload => payload.action ? {ok:true,verified:{}} : new Promise(resolve => {finish=resolve;}));
  await ui.render();
  assert.deepEqual(ui.calls[0].orderIds, [orderId]);
  assert.equal(ui.desktop.children[0].textContent, 'Нет в таблице');
  const pending = ui.click('send');
  await ui.click('send', ui.mobile);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.calls.length, 2);
  finish({ok:true, verified:true, row:17, orderId});
  await pending;
  for (const slot of [ui.desktop, ui.mobile]) {
    assert.equal(slot.children.length, 1);
    assert.equal(slot.children[0].textContent, '✓ Есть в таблице');
    assert.match(slot.children[0].title, /17/);
  }
});

test('ambiguous/failed status and missing write confirmation never display a green receipt', async () => {
  let result = {ok:true, verified:{}, uncertain:[orderId]};
  const ui = harness(() => result);
  await ui.render();
  assert.equal(ui.desktop.dataset.state, 'uncertain');
  result = {ok:false, error:'sheet_access_unavailable'};
  await ui.click('check');
  assert.equal(ui.desktop.dataset.state, 'unknown');
  assert.match(ui.desktop.children[1].textContent, /доступ/);
  result = {ok:true, verified:{}};
  await ui.click('check');
  assert.equal(ui.desktop.dataset.state, 'missing');
  result = {ok:true, orderId, row:3};
  await ui.click('send');
  assert.equal(ui.desktop.dataset.state, 'unknown');
  assert.equal(ui.desktop.children.at(-1).dataset.sheetAction, 'check');
  result = {ok:true, verified:{[orderId]:3}};
  await ui.click('check');
  assert.equal(ui.desktop.dataset.state, 'verified');
});
