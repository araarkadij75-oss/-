(() => {
  'use strict';

  const slots = '[data-sheet-order]';
  const records = new Map();
  const checking = new Set();
  const sending = new Set();
  let session = '';
  let generation = 0;
  let timer;
  const cloud = () => window.MasterAICloud;
  const currentSession = () => cloud()?.connected ? String(cloud().profile?.uid || '') : '';
  const validRow = row => Number.isSafeInteger(row) && row > 1;

  function startSession() {
    const next = currentSession();
    if (next !== session) {
      session = next;
      generation++;
      records.clear();
      checking.clear();
      sending.clear();
    }
    return generation;
  }

  async function request(payload) {
    const token = await cloud()?.getIdToken?.();
    if (!token) throw new Error('Войдите в CRM и дождитесь подключения.');
    const response = await fetch('./crm-api/sheet-order.php', {
      method: 'POST', cache: 'no-store',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      const messages = {
        sheet_not_configured: 'Владельцу нужно подключить исходную таблицу.',
        sheet_access_unavailable: 'CRM не получила доступ к таблице.',
        sheet_service_unavailable: 'Google Таблицы сейчас недоступны.',
        sheet_busy: 'Таблица занята. Повторите проверку.',
        sheet_layout_changed: 'Столбцы в таблице изменились. Нужна сверка.',
        sheet_template_changed: 'Шаблон строки изменился. Нужна сверка.',
        sheet_readback_failed: 'CRM не получила подтверждение записи.',
        sheet_row_changed: 'Строка изменилась. Нужна сверка.',
        sheet_row_conflict: 'Найдено несколько совпадений. Нужна сверка.',
        order_not_found: 'Обновите список заказов.',
        dispatcher_required: 'Войдите под владельцем или диспетчером.'
      };
      const detail = messages[data.error] || data.message || data.error || '';
      throw new Error(/[а-яё]/iu.test(detail) ? detail : 'Не удалось проверить запись. Проверьте подключение таблицы и повторите попытку.');
    }
    return data;
  }

  const sourceNames = {
    direct:'Директ', avito:'Авито', seo:'SEO', other:'Другая отметка', unknown:'Не сверено'
  };
  let sourceByOrder = new Map();
  let sourceRevision = -1;
  let sourceCheckedAt = 0;
  let sourceBusy = false;
  let sourceError = false;

  function sourceKey(order) {
    if (sourceRevision === generation && session === currentSession()) {
      const key = sourceByOrder.get(String(order.orderId || ''));
      if (key) return key;
    }
    return 'unknown';
  }

  function sourceLabel(order) {
    return sourceNames[sourceKey(order)];
  }

  async function refreshSources(revision) {
    const filter = document.getElementById?.('orderSourceFilter');
    if (!filter || !session) return;
    if (sourceRevision !== revision) {
      sourceRevision = revision;
      sourceByOrder.clear();
      sourceCheckedAt = 0;
      sourceBusy = false;
      sourceError = false;
    }
    if (sourceBusy || Date.now() - sourceCheckedAt < (sourceError ? 30000 : 120000)) return;
    const status = document.getElementById('orderSourceStatus');
    if (status) status.textContent = 'Сверяем источники…';
    sourceBusy = true;
    try {
      const data = await request({action:'sources'});
      if (revision !== generation || session !== currentSession()) return;
      if (!data.sources || typeof data.sources !== 'object' || Array.isArray(data.sources)) throw Error('invalid_sources');
      sourceByOrder = new Map(Object.entries(data.sources).filter(([,key]) => Object.hasOwn(sourceNames,key)));
      sourceError = false;
      if (status) status.textContent = '';
    } catch {
      if (revision !== generation || session !== currentSession()) return;
      sourceByOrder.clear();
      sourceError = true;
      if (status) status.textContent = 'Источники временно недоступны';
    } finally {
      if (revision === generation && session === currentSession()) {
        sourceBusy = false;
        sourceCheckedAt = Date.now();
        window.dispatchEvent(new Event('masterai:order-sources'));
      }
    }
  }

  function paint(slot) {
    const id = slot.dataset.sheetOrder;
    const record = records.get(id);
    const status = sending.has(id) ? 'sending' : record?.status || (session ? 'checking' : 'offline');
    const labels = {
      verified: '✓ Есть в таблице', missing: 'Нет в таблице', uncertain: 'Требуется сверка',
      checking: 'Сверяем…', sending: 'Отправляем…', unknown: 'Статус неизвестен', offline: 'Нет связи с CRM'
    };
    const row = record?.row;
    const key = [status, row, record?.message].join('|');
    if (slot.dataset.view === key) return;
    slot.dataset.view = key;
    slot.dataset.state = status;
    const label = document.createElement('span');
    label.className = 'sheet-order-label';
    label.textContent = labels[status];
    label.title = status === 'verified' ? 'Подтверждена строка ' + row : record?.message || labels[status];
    slot.replaceChildren(label);
    if (record?.message && record.showMessage) {
      const note = document.createElement('small');
      note.className = 'sheet-order-note';
      note.setAttribute('role', 'status');
      note.textContent = record.message;
      slot.append(note);
    }
    if (['missing','unknown','uncertain'].includes(status)) {
      const button = document.createElement('button');
      button.className = 'btn small sheet-order-action';
      button.type = 'button';
      button.dataset.sheetAction = status === 'missing' ? 'send' : 'check';
      button.textContent = status === 'missing' ? 'Отправить в таблицу' : 'Проверить';
      button.setAttribute('aria-label', button.textContent + ' · заказ ' + id);
      slot.append(button);
    }
  }

  const paintAll = () => document.querySelectorAll(slots).forEach(paint);

  async function loadStatus(ids, revision, showMessage = false) {
    ids.forEach(id => checking.add(id));
    try {
      const data = await request({action:'status', orderIds:ids});
      if (revision !== generation || session !== currentSession()) return;
      if (!data.verified || typeof data.verified !== 'object' || Array.isArray(data.verified)) throw new Error('Таблица не подтвердила результат сверки.');
      const uncertain = new Set(data.uncertain || []);
      for (const id of ids) {
        if (sending.has(id)) continue;
        const row = data.verified[id];
        const status = validRow(row) ? 'verified' : uncertain.has(id) || row != null ? 'uncertain' : 'missing';
        records.set(id, {status, row, time: Date.now()});
      }
    } catch (error) {
      if (revision === generation) for (const id of ids) {
        if (!sending.has(id)) records.set(id, {status:'unknown', message:error.message, showMessage, time:Date.now()});
      }
    } finally {
      if (revision === generation) {
        ids.forEach(id => checking.delete(id));
        paintAll();
      }
    }
  }

  function refresh() {
    const revision = startSession();
    void refreshSources(revision);
    paintAll();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!session || revision !== generation) return;
      const ids = [...new Set([...document.querySelectorAll(slots)].map(slot => slot.dataset.sheetOrder))]
        .filter(id => !checking.has(id) && !sending.has(id) && Date.now() - (records.get(id)?.time || 0) > 60000);
      for (let i = 0; i < ids.length; i += 100) void loadStatus(ids.slice(i, i + 100), revision);
    }, 120);
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-sheet-action]');
    const slot = button?.closest(slots);
    if (!slot) return;
    event.stopPropagation();
    const id = slot.dataset.sheetOrder;
    const revision = startSession();
    if (!session || sending.has(id) || checking.has(id)) return;
    if (button.dataset.sheetAction !== 'send' || records.get(id)?.status !== 'missing') {
      records.delete(id);
      paintAll();
      await loadStatus([id], revision, true);
      return;
    }
    sending.add(id);
    paintAll();
    try {
      const data = await request({orderId:id});
      if (revision !== generation || session !== currentSession()) return;
      if (data.verified !== true || data.orderId !== id || !validRow(data.row)) throw new Error('Сохранение строки пока не подтверждено.');
      records.set(id, {status:'verified', row:data.row, time:Date.now()});
    } catch (error) {
      if (revision !== generation) return;
      records.set(id, {status:'unknown', message:error.message, showMessage:true, time:Date.now()});
      window.toast?.(error.message);
    } finally {
      if (revision === generation) {
        sending.delete(id);
        paintAll();
      }
    }
  });
  window.MasterAISheetOrders = {refresh, sourceKey, sourceLabel};
  window.addEventListener('masterai:session', refresh);
  window.addEventListener('focus', refresh);
  refresh();
})();
