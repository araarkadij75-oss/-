(() => {
  'use strict';
  const endpoint = './crm-api/telegram.php';
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const noPhone = (value) => String(value ?? '').replace(/(?<!\d)\+?(?:\d[\s().-]*){10,15}(?!\d)/gu, '[номер скрыт]');
  const noApartment = (value) => noPhone(value).replace(/[,;]\s*\d+[\p{L}]?(?:\s*[-/]\s*\d+)?(?:\s*(?:кв\.?|квартира|эт\.?|этаж))?(?=\s*(?:[,;]|$)).*$/iu,'').replace(/[,;]?\s*(?<![\p{L}])(?:квартира|кв\.?|подъезд|этаж|эт\.?|домофон(?:ный\s+код)?|код\s+домофона)(?![\p{L}]).*$/iu, '').trim().replace(/[,;\s-]+$/u, '');

  // All master assignment projections share this sanitizer. The canonical order keeps its full address.
  window.MasterAITelegramPublicAddress = noApartment;

  function telegramErrorMessage(error) {
    const message = String(error?.message || error || '');
    const known = {
      telegram_network_dns_failed: 'Сервер CRM не смог определить адрес Telegram. Подключение не подтверждено.',
      telegram_network_connect_failed: 'Сервер CRM не смог установить соединение с Telegram. Подключение не подтверждено.',
      telegram_network_timeout: 'Telegram не ответил вовремя. Результат операции неизвестен.',
      telegram_network_tls_failed: 'Не удалось установить защищённое соединение с Telegram. Операция не подтверждена.',
      telegram_network_unreachable: 'Сервер CRM не смог связаться с Telegram. Подключение не подтверждено. Попробуйте позже.',
      telegram_service_unavailable: 'Сервис Telegram временно недоступен. Операция не подтверждена.',
      telegram_token_unavailable: 'Ключ Telegram-бота не настроен на сервере. Обратитесь к владельцу CRM.',
      telegram_timeout: 'Telegram не ответил вовремя. Результат операции неизвестен.',
      'Failed to fetch': 'Нет связи с сервером CRM. Проверьте подключение и повторите попытку.',
      'NetworkError when attempting to fetch resource.': 'Нет связи с сервером CRM. Проверьте подключение и повторите попытку.',
    };
    if (known[message]) return known[message];
    if (/^[a-z][a-z0-9_]+$/i.test(message) || !/[а-яё]/i.test(message)) return 'Не удалось выполнить операцию Telegram. Проверьте соединение и настройки бота.';
    return message;
  }

  function notify(message, kind = 'info') {
    if (typeof window.toast === 'function') window.toast(message);
    else {
      const toast = $('#toast');
      if (toast) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3600); }
      else console.info(message);
    }
    const element = $('#toast');
    if (element) {
      element.dataset.telegramKind = kind;
      element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      element.style.background = kind === 'error' ? '#991b1b' : '';
      element.style.color = kind === 'error' ? '#fff' : '';
      element.style.borderColor = kind === 'error' ? '#7f1d1d' : '';
    }
  }

  async function call(op, details = {}) {
    const cloud = window.MasterAICloud;
    if (!cloud?.connected || typeof cloud.getIdToken !== 'function') throw new Error('Войдите в CRM и дождитесь подключения к базе');
    const token = await cloud.getIdToken();
    if (!token) throw new Error('Сессия CRM истекла. Войдите повторно');
    const response = await fetch(endpoint, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, ...details }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'Сервис Telegram временно недоступен');
    return data;
  }

  function showDialog(title, bodyHtml) {
    let dialog = $('#telegramDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'telegramDialog';
      dialog.innerHTML = `<div class="tg-backdrop" role="presentation"><section class="tg-dialog" role="dialog" aria-modal="true" aria-labelledby="tgDialogTitle"><button class="tg-close" type="button" aria-label="Закрыть">×</button><h2 id="tgDialogTitle"></h2><div class="tg-dialog-body"></div></section></div>`;
      document.body.append(dialog);
      dialog.querySelector('.tg-close').onclick = () => dialog.remove();
      dialog.querySelector('.tg-backdrop').onclick = (event) => { if (event.target === event.currentTarget) dialog.remove(); };
      dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') dialog.remove(); });
    }
    dialog.querySelector('#tgDialogTitle').textContent = title;
    dialog.querySelector('.tg-dialog-body').innerHTML = bodyHtml;
    dialog.hidden = false;
  }

  function styleDialog() {
    if ($('#telegramDialogStyles')) return;
    const style = document.createElement('style');
    style.id = 'telegramDialogStyles';
    style.textContent = `#telegramDialog{position:fixed;inset:0;z-index:9999}#telegramDialog[hidden]{display:none}.tg-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45);display:grid;place-items:center;padding:16px}.tg-dialog{position:relative;width:min(520px,100%);background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(15,23,42,.28);color:#172b4d}.tg-dialog h2{font-size:18px;margin:0 42px 14px 0}.tg-close{position:absolute;right:13px;top:11px;border:0;background:#f1f5f9;border-radius:9px;width:32px;height:32px;font-size:22px;cursor:pointer;color:#334155}.tg-dialog-body{line-height:1.5}.tg-link{display:inline-flex;margin-top:12px}.tg-note{font-size:12px;color:#64748b;margin-top:10px}.tg-code{font:700 14px ui-monospace,monospace;word-break:break-all;background:#f1f5f9;padding:10px;border-radius:8px}.tg-order-status{display:block;color:#475569;font-size:12px;margin-top:5px;min-height:16px}`;
    document.head.append(style);
  }

  function addButton(parent, id, text, cls = 'btn small') {
    if (!parent || $('#' + id)) return $('#' + id);
    const button = document.createElement('button');
    button.type = 'button'; button.id = id; button.className = cls; button.textContent = text;
    parent.append(button);
    return button;
  }

  async function setupWebhook(button) {
    const old = button.textContent; button.disabled = true; button.textContent = 'Подключаем…';
    try {
      const result = await call('setup_webhook');
      notify(`Telegram-бот подключён${result.botUsername ? `: @${result.botUsername}` : ''}`);
    } catch (error) { notify(telegramErrorMessage(error), 'error'); }
    finally { button.disabled = false; button.textContent = old; }
  }

  async function pairMaster(button) {
    const old = button.textContent; button.disabled = true; button.textContent = 'Создаём ссылку…';
    try {
      const result = await call('pair_code');
      styleDialog();
      showDialog('Подключение Telegram', `<p>Откройте бота и нажмите «Запустить». Ссылка действует 10 минут и привяжет этот Telegram-аккаунт к профилю мастера.</p><a class="btn primary tg-link" href="${escapeHtml(result.startLink)}" target="_blank" rel="noopener noreferrer">Открыть @${escapeHtml(result.botUsername)}</a><p class="tg-note">Телефон клиента бот не получает. Квартира появится мастеру только после принятия заявки.</p>`);
    } catch (error) { notify(telegramErrorMessage(error), 'error'); }
    finally { button.disabled = false; button.textContent = old; }
  }

  async function pairMasterFromOwner(button) {
    const old = button.textContent; button.disabled = true; button.textContent = 'Загружаем мастеров…';
    try {
      const result = await call('list_masters');
      styleDialog();
      const options = (result.masters || []).map((master) => `<option value="${escapeHtml(master.uid)}" ${master.connected ? 'disabled' : ''}>${escapeHtml(master.name)}${master.connected ? ' — Telegram подключён' : ''}</option>`).join('');
      showDialog('Пригласить мастера в Telegram', `<p>Выберите профиль мастера. CRM создаст персональную ссылку на 10 минут. После её открытия в Telegram аккаунт привяжется к выбранному профилю.</p>${options ? `<label class="tg-note" for="tgMasterSelect">Мастер</label><select id="tgMasterSelect" style="display:block;width:100%;margin:6px 0 12px;padding:10px;border:1px solid #cbd5e1;border-radius:9px"><option value="" selected disabled>Выберите мастера</option>${options}</select><button class="btn primary" type="button" id="tgCreateMasterInvite" disabled>Создать ссылку</button><div id="tgInviteResult" class="tg-note" role="status"></div>` : '<p>Активные профили мастеров не найдены.</p>'}<p class="tg-note">Передайте ссылку только выбранному мастеру. Первый Telegram-аккаунт, который её откроет, будет привязан. Телефон клиента бот не получает; квартира показывается после принятия заказа.</p>`);
      const create = $('#telegramDialog #tgCreateMasterInvite');
      if (create) create.onclick = async () => {
        const select = $('#telegramDialog #tgMasterSelect');
        const targetUid = String(select?.value || '');
        if (!targetUid) return;
        create.disabled = true; create.textContent = 'Создаём ссылку…';
        try {
          const invite = await call('owner_pair_code', { masterUid: targetUid });
          const target = (result.masters || []).find((master) => master.uid === targetUid);
          const output = $('#telegramDialog #tgInviteResult');
          if (output) output.innerHTML = `Ссылка для <strong>${escapeHtml(target?.name || 'мастера')}</strong> действует 10 минут:<input id="tgInviteUrl" readonly value="${escapeHtml(invite.startLink)}" style="display:block;width:100%;box-sizing:border-box;margin:7px 0;padding:9px;border:1px solid #cbd5e1;border-radius:8px"><button class="btn small" type="button" id="tgCopyInvite">Копировать ссылку</button> <a class="tg-link" href="${escapeHtml(invite.startLink)}" target="_blank" rel="noopener noreferrer">Открыть Telegram</a><br><span class="tg-note">Отправьте скопированную ссылку только этому мастеру.</span>`;
          const copy = $('#telegramDialog #tgCopyInvite');
          if (copy) copy.onclick = async () => {
            const input = $('#telegramDialog #tgInviteUrl');
            try { await navigator.clipboard.writeText(invite.startLink); copy.textContent = 'Ссылка скопирована'; }
            catch { input?.focus(); input?.select(); copy.textContent = 'Выделите ссылку и скопируйте'; }
          };
          create.textContent = 'Ссылка создана';
        } catch (error) {
          notify(telegramErrorMessage(error), 'error');
          create.disabled = false; create.textContent = 'Создать ссылку';
        }
      };
      const select = $('#telegramDialog #tgMasterSelect');
      if (select && create) select.onchange = () => { create.disabled = !select.value; };
    } catch (error) { notify(telegramErrorMessage(error), 'error'); }
    finally { button.disabled = false; button.textContent = old; }
  }

  let lastOrderId = '';
  async function sendOrder(button) {
    const orderId = String($('#f_orderId')?.value || '').trim();
    if ($('#orderForm')?.dataset.telegramDirty === '1') { notify('Сохраните изменения заказа перед отправкой мастеру'); return; }
    if (!orderId) { notify('Сначала сохраните заказ, затем отправьте его мастеру'); return; }
    const old = button.textContent; button.disabled = true; button.textContent = 'Отправляем…';
    try {
      const result = await call('send_order', { orderId });
      lastOrderId = orderId;
      const status = $('#telegramOrderStatus');
      if (status && String($('#f_orderId')?.value || '').trim() === orderId) status.textContent = result.state === 'pending' ? 'Заявка отправлена в Telegram' : result.state === 'accepted' ? 'Мастер уже принял эту заявку' : 'Заявка уже отправляется';
      notify(result.state === 'unknown' ? 'Доставка не подтверждена — проверьте Telegram мастера' : result.state === 'sending' ? 'Отправка уже начата, подтверждение ещё не получено' : ['pending', 'accepted'].includes(result.state) ? (result.alreadySent ? 'Заявка уже отправлена мастеру' : 'Заявка отправлена мастеру в Telegram') : 'Доставка не подтверждена — проверьте состояние заказа');
      await refreshStatus(orderId);
    } catch (error) { notify(telegramErrorMessage(error), 'error'); }
    finally { button.disabled = false; button.textContent = old; }
  }

  async function refreshStatus(orderId = '') {
    const id = String(orderId || $('#f_orderId')?.value || '').trim();
    const label = $('#telegramOrderStatus');
    if (!id || !label || !window.MasterAICloud?.profile) return;
    try {
      const result = await call('order_status', { orderId: id });
      const text = ({ not_sent: 'Ещё не отправлено в Telegram', sending: 'Отправляется в Telegram…', pending: 'Ожидает ответа мастера в Telegram', accepted: 'Мастер принял заказ', declined: 'Мастер отказался от заказа', unknown: 'Доставка не подтверждена — проверьте Telegram мастера', failed: 'Отправка не прошла — обратитесь к владельцу' })[result.state] || '';
      if (String($('#f_orderId')?.value || '').trim() === id && label.isConnected) label.textContent = text;
    } catch { /* The status line is informational; preserve the CRM form. */ }
  }

  function mount() {
    const cloud = window.MasterAICloud;
    const profile = cloud?.profile;
    if (!profile || !cloud.connected || !cloud.getIdToken) return;
    const previewNotice = $('#ownerRolePreviewNotice');
    if (previewNotice && !previewNotice.hidden) return;
    const top = $('.top-actions');
    if (!top) return;
    const isMaster = profile.role === 'master';
    const canDispatch = ['owner', 'dispatcher_logistic', 'logistic'].includes(profile.role);
    if (isMaster) {
      const pairButton = addButton(top, 'telegramPairButton', 'Подключить Telegram', 'btn small');
      pairButton.onclick = () => pairMaster(pairButton);
    }
    if (profile.role === 'owner') {
      const setupButton = addButton(top, 'telegramSetupButton', 'Подключить бота', 'btn small');
      setupButton.onclick = () => setupWebhook(setupButton);
      const inviteButton = addButton(top, 'telegramOwnerPairButton', 'Пригласить мастера в Telegram', 'btn small');
      inviteButton.onclick = () => pairMasterFromOwner(inviteButton);
    }
    const masterField = $('#f_master')?.closest('.field');
    if (canDispatch && masterField) {
      const row = masterField.querySelector('.telegram-actions') || document.createElement('div');
      row.className = 'telegram-actions'; row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px';
      const sendButton = addButton(row, 'telegramSendOrderButton', 'Отправить мастеру', 'btn small primary');
      sendButton.onclick = () => sendOrder(sendButton);
      let status = row.querySelector('#telegramOrderStatus');
      if (!status) { status = document.createElement('span'); status.id = 'telegramOrderStatus'; status.className = 'tg-order-status'; row.append(status); }
      if (!row.parentElement) masterField.append(row);
      const id = String($('#f_orderId')?.value || '').trim();
      if (id && id !== lastOrderId) { lastOrderId = id; refreshStatus(id); }
      const idInput = $('#f_orderId');
      if (idInput && !idInput.dataset.telegramBound) {
        idInput.dataset.telegramBound = '1';
        new MutationObserver(() => refreshStatus()).observe(idInput, { attributes: true, attributeFilter: ['value'] });
        idInput.addEventListener('change', () => refreshStatus());
      }
    }
  }

  function boot() {
    for (const eventName of ['input', 'change']) document.addEventListener(eventName, (event) => { if (event.target.closest?.('#orderForm')) $('#orderForm').dataset.telegramDirty = '1'; });
    mount();
    window.addEventListener('masterai:session', mount);
    const observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 20000);
    setInterval(() => {
      if ($('#orderModal')?.classList.contains('open')) {
        const orderId = String($('#f_orderId')?.value || '').trim();
        if (orderId) refreshStatus(orderId);
      }
    }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
