(() => {
  'use strict';
  const API = 'https://remontcompsbp.ru/api';
  const cloud = window.MasterAICloud;
  const allowed = new Set(['owner', 'dispatcher_logistic']);
  const state = { rows: [], selected: null, open: false, busy: false };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let button, panel;
  const role = () => String(cloud?.profile?.role || '');
  async function request(method = 'GET', body) {
    if (!cloud?.connected || !allowed.has(role())) throw new Error('auth');
    const token = await cloud.getIdToken?.();
    if (!token) throw new Error('auth');
    const response = await fetch(`${API}/website-leads`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store', credentials: 'omit',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  function setStatus(message, error = false) {
    const status = panel?.querySelector('[data-web-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(error);
  }
  function dateText(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  function render() {
    if (!panel) return;
    const list = panel.querySelector('[data-web-list]');
    const detail = panel.querySelector('[data-web-detail]');
    const fresh = state.rows.filter(row => row.stage === 'new').length;
    button.querySelector('[data-web-count]').textContent = fresh ? String(fresh) : '';
    button.setAttribute('aria-label', fresh ? `Заявки сайта, новых: ${fresh}` : 'Заявки сайта');
    list.replaceChildren();
    panel.querySelector('[data-web-total]').textContent = `${fresh} новых · ${state.rows.length} всего`;
    if (!state.rows.length) list.append(el('div', 'web-empty', 'Заявок пока нет. Нажмите «Обновить».'));
    for (const row of state.rows) {
      const item = el('button', `web-item${row.id === state.selected?.id ? ' is-selected' : ''}`);
      item.type = 'button';
      item.append(el('strong', '', row.name || row.phone || 'Без имени'));
      item.append(el('span', '', `${row.phone || 'Телефон не указан'} · ${dateText(row.createdAt)}`));
      item.append(el('small', '', row.problem || 'Без описания'));
      if (row.stage === 'new') item.append(el('em', '', 'Новая'));
      item.onclick = () => { state.selected = row; panel.classList.add('has-selection'); render(); };
      list.append(item);
    }
    detail.replaceChildren();
    const row = state.selected;
    if (!row) { panel.classList.remove('has-selection'); detail.append(el('div', 'web-empty', 'Выберите заявку, чтобы посмотреть детали.')); return; }
    const title = el('h3', '', row.name || 'Обращение с сайта');
    const phone = el('a', 'web-phone', row.phone || 'Телефон не указан');
    if (row.phone) phone.href = `tel:${row.phone.replace(/[^+\d]/g, '')}`;
    const back = el('button', 'web-mobile-back', '‹ К списку'); back.type = 'button'; back.onclick = () => { state.selected = null; panel.classList.remove('has-selection'); render(); };
    detail.append(back, title, phone, el('p', '', row.problem || 'Описание не указано'));
    if (row.location) detail.append(el('p', 'web-muted', `Адрес: ${row.location}`));
    detail.append(el('p', 'web-muted', `${dateText(row.createdAt)} · ${row.ticket || ''}`));
    if (row.orderId) detail.append(el('p', 'web-linked', `Связана с заказом ${row.orderId}`));
    const actions = el('div', 'web-actions');
    const stage = document.createElement('select');
    stage.setAttribute('aria-label', 'Этап заявки');
    for (const [value, label] of [['new','Новая'],['thinking','Думает'],['order','Заказ'],['later','Позже'],['rejected','Отказ']]) {
      const option = el('option', '', label); option.value = value; stage.append(option);
    }
    stage.value = row.stage || 'new';
    const save = el('button', 'web-secondary', 'Сохранить этап'); save.type = 'button';
    save.onclick = async () => { await updateLead({ id: row.id, stage: stage.value, orderId: row.orderId || '' }); };
    const makeOrder = el('button', 'web-primary', 'Создать заказ'); makeOrder.type = 'button';
    makeOrder.disabled = typeof window.MASTER_AI_OPEN_ORDER_FROM_WEBSITE !== 'function' || !!row.orderId;
    makeOrder.onclick = () => window.MASTER_AI_OPEN_ORDER_FROM_WEBSITE?.(row);
    actions.append(stage, save, makeOrder); detail.append(actions);
  }
  async function updateLead(body) {
    if (state.busy) return;
    state.busy = true; setStatus('Сохраняю…');
    try {
      await request('POST', body);
      const row = state.rows.find(item => item.id === body.id);
      if (row) { row.stage = body.stage; row.orderId = body.orderId; }
      setStatus('Заявка обновлена.'); render();
    } catch (error) { setStatus(error.message === 'auth' ? 'Войдите как владелец или диспетчер-логист.' : 'Не удалось сохранить. Проверьте подключение и повторите.', true); }
    finally { state.busy = false; }
  }
  async function load() {
    if (state.busy) return;
    state.busy = true; setStatus('Загружаю заявки…');
    try {
      const result = await request();
      state.rows = Array.isArray(result.leads) ? result.leads : [];
      if (state.selected) state.selected = state.rows.find(row => row.id === state.selected.id) || null;
      setStatus('Обновлено вручную · фоновой синхронизации нет.'); render();
    } catch (error) { setStatus(error.message === 'auth' ? 'Войдите как владелец или диспетчер-логист.' : 'Не удалось загрузить заявки. Повторите обновление.', true); }
    finally { state.busy = false; }
  }
  function build() {
    const style = el('style');
    style.textContent = `
      .web-leads-launch{position:fixed;z-index:98998;right:24px;bottom:82px;border:1px solid #bdd2f3;border-radius:16px;background:#f7faff;color:#16418a;padding:11px 15px;font:650 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 26px #102d5c28;cursor:pointer;display:flex;gap:9px;align-items:center}
      .web-leads-badge{min-width:19px;height:19px;border-radius:20px;background:#e25268;color:#fff;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;font-size:11px}
      .web-leads-panel{position:fixed;z-index:98999;right:20px;bottom:140px;width:min(840px,calc(100vw - 32px));height:min(610px,calc(100dvh - 164px));background:#f8fafc;color:#172033;border:1px solid #d8e2f0;border-radius:20px;box-shadow:0 24px 72px #0b1e3b55;display:none;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}
      .web-leads-panel.is-open{display:grid}.web-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(130deg,#101e39,#18345e);color:#fff}.web-head h2{font-size:16px;margin:0}.web-head-actions{display:flex;align-items:center;gap:8px}.web-total{font-size:11px;color:#dbeafe;white-space:nowrap}.web-head button,.web-actions button{border:1px solid #c9d5e6;border-radius:10px;padding:8px 11px;background:#fff;color:#1d355a;font:600 12px system-ui;cursor:pointer}.web-head button{background:#ffffff18;border-color:#ffffff30;color:#fff}.web-status{padding:7px 14px;background:#eef3f9;color:#50617b;font-size:12px;min-height:31px}.web-status[data-error=true]{color:#9b2535;background:#fff0f1}.web-layout{display:grid;grid-template-columns:minmax(220px,36%) minmax(0,1fr);min-height:0}.web-list{overflow:auto;padding:8px;border-right:1px solid #e0e7f0}.web-item{display:grid;gap:4px;width:100%;text-align:left;padding:10px;border:1px solid transparent;border-radius:11px;background:transparent;color:inherit;cursor:pointer}.web-item:hover,.web-item.is-selected{background:#edf3fc;border-color:#d9e5f4}.web-item strong{font-size:13px}.web-item span,.web-item small{font-size:11px;color:#61728b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.web-item em{justify-self:start;font-size:10px;font-style:normal;color:#1758bf;font-weight:700}.web-detail{overflow:auto;padding:18px}.web-detail h3{margin:0 0 8px;font-size:18px}.web-detail p{white-space:pre-wrap;overflow-wrap:anywhere}.web-phone{color:#1558ba;font-weight:700;text-decoration:none}.web-muted{font-size:12px;color:#687992}.web-linked{color:#136b4b;font-weight:650}.web-actions{display:grid;grid-template-columns:minmax(110px,1fr) auto auto;gap:7px;margin-top:16px}.web-actions select{min-width:0;border:1px solid #cbd7e7;border-radius:10px;padding:8px;font:12px system-ui;color:#172033;background:#fff}.web-actions .web-primary{background:#2563eb;color:#fff;border-color:#2563eb}.web-actions button:disabled{opacity:.5;cursor:not-allowed}.web-empty{padding:22px;color:#74839a;text-align:center;font-size:13px}.web-mobile-back{display:none;border:0;background:none;color:#1558ba;font:600 12px system-ui;padding:0 0 12px;cursor:pointer}
      @media(max-width:640px){.web-leads-launch{right:14px;bottom:78px;padding:10px 12px}.web-leads-panel{right:8px;bottom:136px;width:calc(100vw - 16px);height:calc(100dvh - 154px);border-radius:17px}.web-head{padding:12px}.web-layout{grid-template-columns:1fr;grid-template-rows:minmax(0,40%) minmax(0,60%)}.web-list{border-right:0;border-bottom:1px solid #e0e7f0}.web-leads-panel.has-selection .web-list{display:none}.web-leads-panel.has-selection .web-layout{grid-template-rows:minmax(0,1fr)}.web-leads-panel.has-selection .web-mobile-back{display:block}.web-leads-panel:not(.has-selection) .web-detail{display:none}.web-actions{grid-template-columns:1fr 1fr}.web-actions select{grid-column:1/-1}}
      @media(prefers-reduced-motion:no-preference){.web-leads-panel{animation:web-in .18s ease-out}@keyframes web-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}
    `;
    document.head.append(style);
    button = el('button', 'web-leads-launch', 'Заявки сайта'); button.type = 'button'; button.hidden = true;
    const badge = el('span', 'web-leads-badge'); badge.dataset.webCount = ''; button.append(badge);
    button.onclick = () => { state.open = !state.open; panel.classList.toggle('is-open', state.open); if (state.open && !state.rows.length) load(); };
    panel = el('section', 'web-leads-panel'); panel.setAttribute('aria-label', 'Заявки с сайта');
    const header = el('header', 'web-head'); header.append(el('h2', '', 'Заявки с сайта'));
    const actions = el('div', 'web-head-actions');
    const refresh = el('button', '', 'Обновить'); refresh.type = 'button'; refresh.onclick = load;
    const close = el('button', '', 'Закрыть'); close.type = 'button'; close.onclick = () => { state.open = false; panel.classList.remove('is-open'); };
    const count = el('span', 'web-total', '0 новых · 0 всего'); count.dataset.webTotal = '';
    actions.append(count, refresh, close); header.append(actions);
    const status = el('div', 'web-status', 'Обращения сайта · ручное обновление'); status.dataset.webStatus = '';
    const layout = el('div', 'web-layout'); const list = el('div', 'web-list'); list.dataset.webList = '';
    const detail = el('div', 'web-detail'); detail.dataset.webDetail = '';
    layout.append(list, detail); panel.append(header, status, layout); document.body.append(button, panel);
  }
  window.MasterAIWebsiteLeads = {
    markOrder(id, orderId) { return updateLead({ id, stage: 'order', orderId }); },
  };
  function accessChanged() {
    const ok = allowed.has(role()) && cloud?.connected === true;
    button.hidden = !ok;
    if (!ok) { state.open = false; state.rows = []; state.selected = null; panel.classList.remove('is-open', 'has-selection'); render(); }
  }
  build();
  for (const name of ['login', 'restoreSession', 'logout']) {
    const original = cloud?.[name];
    if (typeof original !== 'function' || original.__webLeadsHooked) continue;
    const wrapped = async (...args) => { try { return await original.apply(cloud, args); } finally { accessChanged(); } };
    wrapped.__webLeadsHooked = true; cloud[name] = wrapped;
  }
  Promise.resolve(cloud?.bootPromise).catch(() => {}).finally(accessChanged);
  window.addEventListener('focus', accessChanged);
}
)();
