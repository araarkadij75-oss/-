import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ui = fs.readFileSync(new URL('../hosted-snapshot/telegram-ui.js', import.meta.url), 'utf8');
function uiHarness(call) {
  const elements = { '#f_orderId': { value: 'ORDER-A' }, '#orderForm': { dataset: {} }, '#telegramOrderStatus': { textContent: '', isConnected: true } };
  const notices = [];
  const start = ui.indexOf("  let lastOrderId = '';");
  const end = ui.indexOf('  function mount()', start);
  const context = { $: key => elements[key], call, notify: message => notices.push(message), telegramErrorMessage: error => error.message, window: { MasterAICloud: { profile: {} } } };
  const methods = vm.runInNewContext(ui.slice(start, end) + ';({sendOrder,refreshStatus})', context);
  return { elements, notices, ...methods };
}

test('Telegram status response cannot overwrite a subsequently opened order', async () => {
  let resolve;
  const h = uiHarness(() => new Promise(r => { resolve = r; }));
  const pending = h.refreshStatus();
  h.elements['#f_orderId'].value = 'ORDER-B';
  h.elements['#telegramOrderStatus'].textContent = 'B status';
  resolve({ state: 'accepted' });
  await pending;
  assert.equal(h.elements['#telegramOrderStatus'].textContent, 'B status');
});

test('Unsaved edits cannot dispatch a stale server version', async () => {
  let calls = 0;
  const h = uiHarness(async () => { calls++; return { state: 'pending' }; });
  h.elements['#orderForm'].dataset.telegramDirty = '1';
  await h.sendOrder({ textContent: 'Отправить', disabled: false });
  assert.equal(calls, 0);
  assert.match(h.notices[0], /Сохраните изменения/);
});

test('Sending uses canonical order number and restores the button after a failure', async () => {
  const requests = [];
  const h = uiHarness(async (op, payload) => { requests.push([op, payload.orderId]); throw new Error('offline'); });
  const button = { textContent: 'Отправить', disabled: false };
  await h.sendOrder(button);
  assert.deepEqual(requests, [['send_order', 'ORDER-A']]);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Отправить');
});

for (const name of ['index.html', 'master.html', 'dispatcher-logistic.html']) {
  test(`${name}: master projection hides Russian apartment labels and embedded phones`, () => {
    const html = fs.readFileSync(new URL('../hosted-snapshot/' + name, import.meta.url), 'utf8');
    const body = html.match(/const masterSafe=([\s\S]*?return o\});/)[1];
    const safe = vm.runInNewContext('(' + body + ')', { masterKey: x => x });
    for (const address of ['Ленина 1, кв 25', 'Ленина 1, квартира 25', 'Ленина 1, кв. 25', 'Ленина 1, кв №25', 'Ленина 1, квартира: 25', 'Ленина 1, 87', 'Ленина 1, 87, 7 этаж']) {
      const output = safe({ address, request: 'Позвонить +7 (999) 123-45-67, квартира 25', master: 'Иван' }, 'master-1');
      assert.equal(output.address, 'Ленина 1');
      assert.doesNotMatch(output.request, /123|25/);
    }
    assert.equal(safe({ address: 'Ленина д.7, корп.1' }, 'm').address, 'Ленина д.7, корп.1');
    assert.equal(safe({ address: 'Ленина 1, кв 25', _acceptedAt: '2026-10-31', _masterStage: 'enroute' }, 'm').address, 'Ленина 1, кв 25');
  });
}


test('Telegram public address removes unlabelled apartment tail but keeps corpus', () => {
  const source=ui.slice(ui.indexOf('  const noPhone'),ui.indexOf('  window.MasterAITelegramPublicAddress'));
  const publicAddress=vm.runInNewContext(source+';noApartment');
  for(const address of ['Бабушкина 135, 87','Бабушкина 135, кв №25','Бабушкина 135, квартира: 25']) assert.equal(publicAddress(address),'Бабушкина 135');
  assert.equal(publicAddress('Ленина д.7, корп.1'),'Ленина д.7, корп.1');
});
