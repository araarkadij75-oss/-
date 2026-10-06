import { chatKey, chatPreview, dedupeChats, displayName, isOutgoing, isUnread, listFromEnvelope, messageList, orderMessages, readableMessage } from './b2bhelp-inbox-core.mjs';

(() => {
  'use strict';
  const API = 'https://remontcompsbp.ru/api';
  const cloud = window.MasterAICloud;
  const allowed = new Set(['owner', 'dispatcher_logistic']);
  const state = { chats: [], accounts: [], selected: null, messages: [], currentLead: null, filter: 'new', busy: false, panel: false, error: '' };
  let button, panel, timer, selectionEpoch = 0;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const dateText = value => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value).slice(0, 30) : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  };
  const currentRole = () => String(cloud?.profile?.role || '');
  const setStatus = (message, kind = '') => {
    const n = panel?.querySelector('[data-b2b-status]');
    if (!n) return;
    n.textContent = message;
    n.dataset.kind = kind;
  };
  const escapeFriendlyError = error => {
    const code = String(error?.message || error || '');
    if (/auth_unavailable|membership_unavailable/i.test(code)) return 'Сервер REG.RU не смог проверить доступ в Firebase. Повторите обновление.';
    if (/timeout|abort/i.test(code)) return 'Сервер не ответил вовремя. Повторите обновление.';
    if (/b2bhelp_not_configured/i.test(code)) return 'Шлюз ещё не подключён к B2BHelp.';
    if (/^auth$|401/i.test(code)) return 'Сессия истекла. Войдите в CRM снова.';
    if (/^role$/i.test(code)) return 'Сообщения доступны владельцу и диспетчеру-логисту.';
    if (/origin/i.test(code)) return 'Домен CRM не разрешён сервером.';
    if (/upstream/i.test(code)) return 'B2BHelp не ответил шлюзу REG.RU. Проверьте доступность и подключение B2BHelp.';
    if (/failed to fetch|network|load failed/i.test(code)) return 'Не удалось связаться с сервером. Проверьте соединение.';
    return 'Не удалось загрузить данные B2BHelp. Попробуйте обновить.';
  };
  async function request(path, options = {}) {
    if (!cloud || !allowed.has(currentRole()) || !cloud.connected) throw new Error('auth');
    const token = await cloud.getIdToken?.();
    if (!token) throw new Error('auth');
    const response = await fetch(`${API}${path}`, {
      method: options.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }
  async function loadPages(path, key, maxPages = 4) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const payload = await request(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=50`);
      const batch = key ? listFromEnvelope(payload, key) : messageList(payload);
      all.push(...batch);
      if (batch.length < 50) break;
    }
    return all;
  }
  function selectedAccountId(chat) {
    const id = String(chat?.account?.id ?? chat?.account_id ?? '').trim();
    return /^\d+$/.test(id) ? id : '';
  }
  function filteredChats() {
    return state.chats.filter(chat => chatKey(chat) && (state.filter === 'all' || isUnread(chat)));
  }
  function render() {
    if (!panel) return;
    const list = panel.querySelector('[data-b2b-list]');
    const messages = panel.querySelector('[data-b2b-messages]');
    const count = state.chats.filter(isUnread).length;
    button.querySelector('[data-b2b-count]').textContent = count ? String(count) : '';
    button.setAttribute('aria-label', count ? `Сообщения B2BHelp, новых: ${count}` : 'Сообщения B2BHelp');
    list.replaceChildren();
    panel.querySelector('[data-b2b-count-label]').textContent = `${count} новых`;
    panel.querySelector('[data-b2b-filter-new]').setAttribute('aria-pressed', String(state.filter === 'new'));
    panel.querySelector('[data-b2b-filter-all]').setAttribute('aria-pressed', String(state.filter === 'all'));
    const chats = filteredChats();
    if (!chats.length) list.append(el('div', 'b2b-empty', state.chats.length ? 'Новых сообщений пока нет.' : 'Нажмите «Обновить», чтобы загрузить входящие.'));
    for (const chat of chats) {
      const item = el('button', `b2b-chat${chat === state.selected ? ' is-selected' : ''}`);
      item.type = 'button';
      item.setAttribute('aria-label', `${displayName(chat)}${isUnread(chat) ? ', новое сообщение' : ''}`);
      const top = el('span', 'b2b-chat-top');
      top.append(el('strong', '', displayName(chat)));
      top.append(el('time', '', dateText(chat?.last_message?.created_at ?? chat?.last_message?.date ?? chat?.updated_at)));
      item.append(top, el('span', 'b2b-chat-preview', chatPreview(chat)));
      if (chat?.advert?.title) item.append(el('span', 'b2b-chat-ad', String(chat.advert.title).slice(0, 100)));
      if (isUnread(chat)) item.append(el('span', 'b2b-unread-dot', 'Новое'));
      item.addEventListener('click', () => openChat(chat));
      list.append(item);
    }
    messages.replaceChildren();
    const title = panel.querySelector('[data-b2b-title]');
    const order = panel.querySelector('[data-b2b-order]');
    const back = panel.querySelector('[data-b2b-back]');
    const dealControls = panel.querySelector('[data-b2b-deal-controls]');
    const convLabel = panel.querySelector('[data-b2b-conv-label]');
    if (!state.selected) {
      title.textContent = 'Входящие B2BHelp';
      convLabel.textContent = 'Выберите диалог';
      order.hidden = true;
      back.hidden = true;
      dealControls.hidden = true;
      panel.classList.remove('has-chat');
      return;
    }
    panel.classList.add('has-chat');
    title.textContent = displayName(state.selected);
    convLabel.textContent = 'Карточка сделки';
    back.hidden = false;
    order.hidden = false;
    dealControls.hidden = false;
    panel.querySelector('[data-b2b-stage]').value = state.currentLead?.stage || 'new';
    const masterSelect = panel.querySelector('[data-b2b-master]');
    const masterNames = typeof window.MasterAIMasters === 'function' ? window.MasterAIMasters() : [];
    const selectedMaster = state.currentLead?.assignedMaster || '';
    masterSelect.replaceChildren(el('option', '', 'Без мастера'));
    masterSelect.firstElementChild.value = '';
    for (const name of masterNames) {
      const option = el('option', '', String(name)); option.value = String(name); masterSelect.append(option);
    }
    if (selectedMaster && !masterNames.includes(selectedMaster)) {
      const option = el('option', '', selectedMaster); option.value = selectedMaster; masterSelect.append(option);
    }
    masterSelect.value = selectedMaster;
    panel.querySelector('[data-b2b-note]').value = state.currentLead?.internalNote || '';
    panel.querySelector('[data-b2b-linked-order]').textContent = state.currentLead?.orderId ? `Заказ ${state.currentLead.orderId} связан` : '';
    order.disabled = typeof window.MASTER_AI_OPEN_ORDER_FROM_B2B !== 'function';
    order.onclick = async () => {
      if (!await saveLeadControls()) return;
      const preview = chatPreview(state.selected);
      const incoming = [...state.messages].reverse().find(message => !isOutgoing(message) && readableMessage(message));
      const lead = {
        name: displayName(state.selected),
        request: incoming ? readableMessage(incoming) : (preview === 'Откройте диалог' ? String(state.selected?.advert?.title || '') : preview),
        accountId: selectedAccountId(state.selected),
        chatId: String(state.selected?.id || ''),
        assignedMaster: panel.querySelector('[data-b2b-master]').value,
      };
      window.MASTER_AI_OPEN_ORDER_FROM_B2B?.(lead);
    };
    if (!state.messages.length) messages.append(el('div', 'b2b-empty', state.busy ? 'Загрузка переписки…' : 'В этом чате пока нет сообщений.'));
    for (const message of state.messages) {
      const body = readableMessage(message);
      if (!body) continue;
      const bubble = el('article', `b2b-message${isOutgoing(message) ? ' is-outgoing' : ''}`);
      bubble.append(el('div', 'b2b-message-text', body));
      const when = message?.created_at ?? message?.createdAt ?? message?.date ?? message?.time;
      if (when) bubble.append(el('time', 'b2b-message-time', dateText(when)));
      messages.append(bubble);
    }
    messages.scrollTop = messages.scrollHeight;
  }
  async function refreshInbox() {
    if (state.busy) return;
    state.busy = true;
    setStatus('Загружаю диалоги B2BHelp…');
    render();
    try {
      state.chats = dedupeChats(await loadPages('/chats', 'chats', 4));
      // Manual refresh is the only ingestion point: upsert unread chats so they
      // become durable, deduplicated CRM leads without background polling.
      const unread = state.chats.filter(chat => isUnread(chat) && chatKey(chat));
      for (let start = 0; start < unread.length; start += 5) {
        await Promise.all(unread.slice(start, start + 5).map(async chat => {
          try { await cloud.saveB2BLead?.(leadRecord(chat)); }
          catch { /* Keep the inbox usable; opening the chat retries the upsert. */ }
        }));
      }
      if (state.selected) state.selected = state.chats.find(c => chatKey(c) === chatKey(state.selected)) || null;
      setStatus(`Обновлено в ${new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })} · ${state.chats.length} диалогов · новые: ${unread.length}`, 'ok');
      if (state.selected) await loadMessages(state.selected, false);
    } catch (error) {
      state.error = escapeFriendlyError(error);
      setStatus(state.error, 'error');
    } finally {
      state.busy = false;
      render();
    }
  }
  async function loadMessages(chat, markRead = true) {
    const epoch = selectionEpoch;
    const accountId = selectedAccountId(chat);
    if (!accountId) {
      state.messages = [];
      setStatus('В ответе B2BHelp не указан аккаунт чата.', 'error');
      return;
    }
    state.busy = true;
    render();
    try {
      const query = new URLSearchParams({ chat_id: String(chat.id), account_id: accountId });
      const loaded = orderMessages(await loadPages(`/messages?${query}`, null, 4));
      if (epoch !== selectionEpoch || chatKey(chat) !== chatKey(state.selected)) return;
      state.messages = loaded;
      if (markRead && isUnread(chat)) {
        await request('/read', { method: 'POST', body: { chat_id: String(chat.id), account_id: Number(accountId) } });
        chat.is_unread = false;
        if (cloud?.saveB2BLead) await cloud.saveB2BLead(leadRecord(chat));
      }
      setStatus('Соединение через B2BHelp · без фоновой синхронизации', 'ok');
    } catch (error) {
      setStatus(escapeFriendlyError(error), 'error');
    } finally {
      if (epoch === selectionEpoch) { state.busy = false; render(); }
    }
  }
  function leadRecord(chat) {
    return {
      accountId: selectedAccountId(chat),
      chatId: String(chat?.id || ''),
      name: displayName(chat),
      advertTitle: String(chat?.advert?.title || '').slice(0, 200),
      preview: chatPreview(chat).slice(0, 500),
      isUnread: isUnread(chat),
    };
  }
  async function openChat(chat) {
    const epoch = ++selectionEpoch;
    if (chatKey(chat) !== chatKey(state.selected)) panel.querySelector('[data-b2b-input]').value = '';
    state.selected = chat;
    state.messages = [];
    state.currentLead = null;
    render();
    try {
      const lead = await cloud.saveB2BLead?.(leadRecord(chat)) || null;
      if (epoch !== selectionEpoch) return;
      state.currentLead = lead;
    }
    catch (error) { setStatus('Чат открыт, но карточка лида не сохранилась: проверьте права CRM.', 'error'); }
    if (epoch !== selectionEpoch) return;
    await loadMessages(chat, true);
  }
  async function sendMessage() {
    const input = panel.querySelector('[data-b2b-input]');
    const text = input.value.trim();
    if (!state.selected || !text || state.busy) return;
    if (text.length > 1000) return setStatus('Сообщение не должно превышать 1000 символов.', 'error');
    const chat = state.selected;
    const epoch = selectionEpoch;
    const accountId = selectedAccountId(chat);
    state.busy = true;
    setStatus('Отправляю через B2BHelp…');
    try {
      await request('/send', { method: 'POST', body: { chat_id: String(chat.id), account_id: Number(accountId), text } });
      input.value = '';
      if (epoch !== selectionEpoch) return;
      await loadMessages(chat, false);
      setStatus('Сообщение отправлено через B2BHelp.', 'ok');
    } catch (error) {
      setStatus(escapeFriendlyError(error), 'error');
    } finally {
      if (epoch === selectionEpoch) { state.busy = false; render(); }
    }
  }
  async function saveLeadControls() {
    if (!state.selected || !cloud?.saveB2BLead || state.busy) return false;
    const chat = state.selected;
    const epoch = selectionEpoch;
    state.busy = true;
    setStatus('Сохраняю карточку сделки…');
    try {
      const savedLead = await cloud.saveB2BLead({
        ...leadRecord(chat),
        stage: panel.querySelector('[data-b2b-stage]').value,
        assignedMaster: panel.querySelector('[data-b2b-master]').value,
        internalNote: panel.querySelector('[data-b2b-note]').value,
        orderId: state.currentLead?.orderId || '',
      });
      if (epoch !== selectionEpoch) return false;
      state.currentLead = savedLead;
      setStatus('Этап и назначение сохранены в карточке лида.', 'ok');
      return true;
    } catch (error) { setStatus(escapeFriendlyError(error), 'error'); return false; }
    finally { if (epoch === selectionEpoch) { state.busy = false; render(); } }
  }
  function buildUI() {
    const style = el('style');
    style.textContent = `
      .b2b-launch{position:fixed;z-index:99000;right:24px;bottom:24px;border:0;border-radius:18px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;padding:13px 18px;font:600 14px/1.2 system-ui,sans-serif;box-shadow:0 10px 32px #102d5c55;cursor:pointer;display:flex;gap:10px;align-items:center}
      .b2b-badge{min-width:20px;height:20px;border-radius:20px;background:#fb7185;color:#fff;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;font-size:11px}
      .b2b-panel{position:fixed;z-index:99001;right:20px;bottom:82px;width:min(890px,calc(100vw - 32px));height:min(690px,calc(100dvh - 112px));background:#f8fafc;color:#172033;border:1px solid #d8e2f0;border-radius:22px;box-shadow:0 24px 72px #0b1e3b55;display:none;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}
      .b2b-panel.is-open{display:grid}.b2b-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;background:linear-gradient(130deg,#101e39,#18345e);color:#fff}.b2b-head h2{margin:0;font-size:16px;font-weight:650}.b2b-actions{display:flex;gap:8px;align-items:center}.b2b-btn{border:1px solid #c9d5e6;border-radius:10px;padding:8px 11px;background:#fff;color:#1d355a;font:600 12px system-ui;cursor:pointer}.b2b-head .b2b-btn{background:#ffffff18;border-color:#ffffff30;color:#fff}.b2b-status{padding:8px 16px;font-size:12px;color:#50617b;background:#eef3f9;min-height:32px}.b2b-status[data-kind=error]{color:#9b2535;background:#fff0f1}.b2b-status[data-kind=ok]{color:#136b4b}.b2b-body{display:grid;grid-template-columns:310px minmax(0,1fr);min-height:0}.b2b-sidebar{border-right:1px solid #e0e7f0;display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0}.b2b-filter{display:flex;gap:8px;padding:10px}.b2b-filter .b2b-btn[aria-pressed=true]{background:#e6efff;border-color:#7ea4f6;color:#1549aa}.b2b-list{overflow:auto;padding:0 8px 10px}.b2b-chat{position:relative;width:100%;display:block;text-align:left;border:1px solid transparent;border-radius:12px;background:transparent;padding:11px 12px;margin:2px 0;color:inherit;cursor:pointer}.b2b-chat:hover,.b2b-chat.is-selected{background:#edf3fc;border-color:#d9e5f4}.b2b-chat-top{display:flex;gap:8px;justify-content:space-between;align-items:center}.b2b-chat-top strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.b2b-chat-top time,.b2b-message-time{font-size:10px;color:#6b7c96;white-space:nowrap}.b2b-chat-preview{display:block;margin-top:5px;color:#586981;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px}.b2b-chat-ad{display:block;color:#8190a5;font-size:10px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.b2b-unread-dot{display:inline-block;margin-top:6px;color:#1758bf;font-size:10px;font-weight:700}.b2b-conversation{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0;min-height:0}.b2b-conv-head{padding:12px 16px;border-bottom:1px solid #e0e7f0;display:grid;grid-template-columns:1fr;gap:8px;font-weight:650}.b2b-conv-title{font-size:12px;color:#536681}.b2b-deal-controls{display:grid;grid-template-columns:minmax(110px,.8fr) minmax(130px,1fr) minmax(180px,1.5fr) auto;gap:7px;align-items:center}.b2b-select,.b2b-note{width:100%;min-width:0;border:1px solid #cbd7e7;border-radius:10px;padding:8px 9px;background:#fff;color:#172033;font:12px system-ui,-apple-system,Segoe UI,sans-serif}.b2b-linked-order{grid-column:1/-1;color:#136b4b;font-size:11px;font-weight:600}.b2b-messages{overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:linear-gradient(#f8fafc,#f3f6fb)}.b2b-message{align-self:flex-start;max-width:min(85%,520px);background:#fff;border:1px solid #e0e7f0;border-radius:4px 14px 14px;padding:10px 12px;box-shadow:0 2px 8px #16345a08;white-space:pre-wrap;overflow-wrap:anywhere}.b2b-message.is-outgoing{align-self:flex-end;background:#eaf2ff;border-color:#d5e3fb;border-radius:14px 4px 14px 14px}.b2b-message-time{display:block;text-align:right;margin-top:4px}.b2b-composer{display:flex;gap:8px;padding:12px;border-top:1px solid #e0e7f0;background:#fff}.b2b-composer textarea{resize:none;min-height:42px;max-height:110px;flex:1;border:1px solid #cbd7e7;border-radius:12px;padding:10px 12px;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:inherit}.b2b-empty{padding:20px;color:#74839a;text-align:center;font-size:13px}.b2b-new-order{background:#e8f2ff;border-color:#bad2fb}.b2b-back{display:none}.b2b-panel.has-chat .b2b-back{display:inline-block}
      @media(max-width:640px){.b2b-launch{right:14px;bottom:14px}.b2b-panel{right:8px;bottom:68px;width:calc(100vw - 16px);height:calc(100dvh - 84px);border-radius:18px}.b2b-head{align-items:flex-start;gap:10px;flex-direction:column}.b2b-actions{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.b2b-actions .b2b-btn{min-width:0;padding:8px 6px;white-space:normal}.b2b-body{grid-template-columns:1fr;grid-template-rows:minmax(0,36%) minmax(0,64%)}.b2b-sidebar{border-right:0;border-bottom:1px solid #e0e7f0}.b2b-panel.has-chat .b2b-sidebar{display:none}.b2b-panel.has-chat .b2b-body{grid-template-rows:minmax(0,1fr)}.b2b-panel:not(.has-chat) .b2b-conversation{display:none}.b2b-panel.has-chat .b2b-back{display:inline-block}.b2b-chat-preview{max-width:calc(100vw - 70px)}.b2b-deal-controls{grid-template-columns:repeat(2,minmax(0,1fr))}.b2b-note{grid-column:1/-1}.b2b-linked-order{grid-column:1/-1}}
      @media(prefers-reduced-motion:no-preference){.b2b-panel{animation:b2b-in .18s ease-out}@keyframes b2b-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}
    `;
    document.head.append(style);
    button = el('button', 'b2b-launch'); button.type = 'button'; button.hidden = true;
    button.append(el('span', '', 'Сообщения'), el('span', 'b2b-badge')); button.querySelector('.b2b-badge').dataset.b2bCount = '';
    button.addEventListener('click', () => { state.panel = !state.panel; panel.classList.toggle('is-open', state.panel); if (state.panel && !state.chats.length) refreshInbox(); });
    panel = el('section', 'b2b-panel'); panel.setAttribute('aria-label', 'Входящие сообщения B2BHelp');
    const head = el('header', 'b2b-head');
    const headTitle = el('h2', '', 'Входящие B2BHelp'); headTitle.dataset.b2bTitle = '';
    const actions = el('div', 'b2b-actions');
    const back = el('button', 'b2b-btn b2b-back', 'К диалогам'); back.type='button'; back.dataset.b2bBack=''; back.onclick=()=>{state.selected=null;state.messages=[];render()};
    const createOrder = el('button', 'b2b-btn b2b-new-order', 'Создать заказ'); createOrder.type='button'; createOrder.dataset.b2bOrder='';
    const refresh = el('button', 'b2b-btn', 'Обновить'); refresh.type='button'; refresh.onclick=refreshInbox;
    const close = el('button', 'b2b-btn', 'Закрыть'); close.type='button'; close.onclick=()=>{state.panel=false;panel.classList.remove('is-open')};
    actions.append(back, createOrder, refresh, close); head.append(headTitle, actions);
    const status=el('div','b2b-status','Подключение только по запросу');status.dataset.b2bStatus='';
    const body=el('div','b2b-body');
    const sidebar=el('aside','b2b-sidebar');
    const filter=el('div','b2b-filter');
    const newFilter=el('button','b2b-btn','Новые');newFilter.type='button';newFilter.dataset.b2bFilterNew='';newFilter.onclick=()=>{state.filter='new';render()};
    const allFilter=el('button','b2b-btn','Все');allFilter.type='button';allFilter.dataset.b2bFilterAll='';allFilter.onclick=()=>{state.filter='all';render()};
    const countLabel=el('span','b2b-status','0 новых');countLabel.dataset.b2bCountLabel='';countLabel.style.marginLeft='auto';countLabel.style.background='transparent';
    filter.append(newFilter,allFilter,countLabel);
    const list=el('div','b2b-list');list.dataset.b2bList=''; sidebar.append(filter,list);
    const conversation=el('main','b2b-conversation');
    const convHead=el('div','b2b-conv-head');
    const convLabel=el('strong','b2b-conv-title','Выберите диалог'); convLabel.dataset.b2bConvLabel=''; convHead.append(convLabel);
    const dealControls=el('div','b2b-deal-controls'); dealControls.dataset.b2bDealControls=''; dealControls.hidden=true;
    const dealStage=el('select','b2b-select'); dealStage.dataset.b2bStage=''; dealStage.setAttribute('aria-label','Этап сделки');
    for (const [value,label] of [['new','Новый'],['thinking','Думает'],['order','Заказ'],['later','Позже'],['rejected','Отказ']]) { const option=el('option','',label); option.value=value; dealStage.append(option); }
    const dealMaster=el('select','b2b-select'); dealMaster.dataset.b2bMaster=''; dealMaster.setAttribute('aria-label','Назначить мастера');
    const dealNote=el('input','b2b-note'); dealNote.dataset.b2bNote=''; dealNote.maxLength=2000; dealNote.placeholder='Внутренняя заметка'; dealNote.setAttribute('aria-label','Внутренняя заметка');
    const dealSave=el('button','b2b-btn','Сохранить этап'); dealSave.type='button'; dealSave.onclick=saveLeadControls;
    const linkedOrder=el('span','b2b-linked-order'); linkedOrder.dataset.b2bLinkedOrder='';
    dealControls.append(dealStage,dealMaster,dealNote,dealSave,linkedOrder); convHead.append(dealControls);
    const messages=el('div','b2b-messages');messages.dataset.b2bMessages='';
    const composer=el('form','b2b-composer');
    const input=el('textarea');input.dataset.b2bInput='';input.maxLength=1000;input.placeholder='Напишите ответ…';input.setAttribute('aria-label','Текст сообщения');
    const send=el('button','b2b-btn','Отправить');send.type='submit';composer.append(input,send);
    composer.addEventListener('submit',event=>{event.preventDefault();sendMessage()});
    conversation.append(convHead,messages,composer); body.append(sidebar,conversation); panel.append(head,status,body);
    document.body.append(button,panel);
  }
  function accessChanged() {
    const ok = allowed.has(currentRole()) && cloud?.connected === true;
    button.hidden = !ok;
    if (!ok) { panel.classList.remove('is-open'); state.panel=false; state.chats=[]; state.accounts=[]; state.selected=null; state.messages=[]; state.filter='new'; render(); }
  }
  function hookSession() {
    for (const name of ['login','restoreSession','logout']) {
      const original = cloud?.[name];
      if (typeof original !== 'function' || original.__b2bHooked) continue;
      const wrapped = async (...args) => { try { return await original.apply(cloud,args); } finally { accessChanged(); } };
      wrapped.__b2bHooked=true; cloud[name]=wrapped;
    }
    accessChanged();
  }
  buildUI();
  hookSession();
  Promise.resolve(cloud?.bootPromise).catch(() => {}).finally(() => { hookSession(); accessChanged(); });
  window.addEventListener('masterai:session', accessChanged);
  window.addEventListener('focus', accessChanged);
  document.addEventListener('visibilitychange', accessChanged);
  document.addEventListener('click', () => { if (timer) clearTimeout(timer); timer=setTimeout(accessChanged,250); }, true);
  window.addEventListener('beforeunload', () => { if(timer)clearTimeout(timer) }, { once:true });
})();
