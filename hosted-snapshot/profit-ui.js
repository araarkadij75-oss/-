(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const money = n => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(n) || 0);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fieldPreview = (key, value) => key === '_cashRefunds' && Array.isArray(value) ? value.map(r => r.date + ' · компания ' + money(r.companyCents / 100) + ' · мастер ' + money(r.masterCents / 100)).join(', ') : key === '_cashReceipts' && Array.isArray(value) ? value.map(r => r.date + ' · ' + money(r.cents / 100)).join(', ') : (value ?? 'Поле отсутствует');
  const state = { expenses: [], workbook: null, raw: [], parsed: null, selected: new Set(), busy: false, source: '' };
  const bridge = () => window.MasterAIProfitBridge;
  const snapshot = () => bridge()?.snapshot() || {};
  const owner = () => { const s = snapshot(); return s.connected === true && (s.userRole || s.userrole || s.role || s.user?.role) === 'owner'; };
  function notice(text, error = false) { const el = $('#profitNotice'); if (el) { el.textContent = text; el.className = 'notice ' + (error ? 'error' : 'ok'); el.hidden = !text; } }
  function expensePayload(r, account = '') {
    const cents=Math.round(Math.abs(Number(r.amount))*100);
    if(!Number.isSafeInteger(cents)||cents<=0||!/^\d{4}-\d{2}-\d{2}$/.test(r.date||''))throw new Error('В выбранной строке некорректны дата или сумма.');
    const note=String(r.description||'')+(r.periodFrom&&r.periodTo&&Number.isFinite(Number(r.bonus))?` · Бонусы по отчёту: ${money(r.bonus)} (справочно; сумму расхода не меняют)`: '');
    return {date:r.date,amountCents:cents,kind:Number(r.amount)<0?'refund':'expense',category:'Реклама',source:'avito',externalId:String(r.operationId||r.key||''),account:String(account).trim(),note:note.slice(0,4000),...(r.periodFrom&&r.periodTo?{periodFrom:r.periodFrom,periodTo:r.periodTo,statisticId:String(r.statisticId||'')}:{})};
  }
  async function api(op, details = {}) {
    if (!owner()) throw new Error('Раздел доступен только владельцу.');
    const cloud = window.MasterAICloud;
    if (!cloud?.connected) throw new Error('Нет связи с базой. Дождитесь подключения.');
    const actorId=String(cloud.profile?.uid||cloud.profile?.id||'');
    const token = await cloud.getIdToken();
    if (!token) throw new Error('Сессия истекла. Войдите повторно.');
    const response = await fetch('./crm-api/finance.php', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ op, ...details }) });
    const data = await response.json().catch(() => ({}));
    if(!owner()||!cloud.connected||String(cloud.profile?.uid||cloud.profile?.id||'')!==actorId)throw new Error('Сессия изменилась. Обновите раздел после входа.');
    const coverageErrors = {
      expense_account_required:'Выберите кабинет Авито: даты отчёта пересекаются с дневными расходами B2BHelp.',
      expense_partial_coverage:'Дневные расходы B2BHelp покрывают только часть периода или выбранные периоды перекрываются. Разделите выгрузку по датам.',
      expense_coverage_mismatch:'Сумма выбранных операций расходится с дневными расходами B2BHelp. Проверьте полноту выгрузки, возвраты и выбранный кабинет.'
    };
    if (!response.ok && coverageErrors[data.error]) throw new Error(coverageErrors[data.error]);
    if (!response.ok || data.ok !== true) throw new Error(({ 400:'Проверьте даты и суммы выбранных строк.', 403:'Для этого действия нужен вход владельца.', 409:'Найден конфликт: операция уже загружена с другими данными либо периоды статистики пересекаются. Не добавляйте статистику и отдельные операции одного кабинета за одинаковые даты.', 413:'Слишком много строк. Разделите загрузку на части до 1000 строк.' })[response.status] || 'Не удалось сохранить расходы. Попробуйте позже.');
    return data;
  }
  async function action(button, fn) {
    if (state.busy) return;
    state.busy = true; button.disabled = true;
    try { await fn(); } catch (e) { notice(e.message || 'Не удалось выполнить действие.', true); }
    finally { state.busy = false; button.disabled = button.id==='reconcileApply'&&!$('#reconcileConsent')?.checked; updateImportButton(); }
  }
  function moscowDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return [fields.year, fields.month, fields.day].join('-');
  }
  function renderPeriodSections(result) {
    const sections = result.periodSections;
    const panel = $('#profitPeriodSections');
    if (!panel) return;
    if (!sections) { panel.hidden = true; return; }
    const rows = [[sections.completed, 'Завершённые дни'], [sections.today, 'Сегодня · день открыт']].filter(([part]) => part);
    panel.hidden = !rows.length;
    if (!rows.length) return;
    const dateLabel = date => String(date).split('-').reverse().join('.');
    const fields = ['companyCash','salary','ads','other','profit'];
    const html = rows.map(([part, label]) => {
      const date = part.from === part.to ? dateLabel(part.to) : dateLabel(part.from) + ' – ' + dateLabel(part.to);
      const warnings = (part.issues || part.warnings || []).map(item => typeof item === 'string' ? item : item.message).filter(Boolean);
      const notes = warnings.length ? '<details><summary>Требует сверки</summary><ul>' + warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></details>' : '';
      return '<tr><th scope="row">' + label + '<br><small>' + esc(date) + '</small></th>' +
        fields.map(key => '<td class="num">' + (part[key] == null ? '—' : money(part[key])) + '</td>').join('') +
        '</tr>' + (notes ? '<tr><td colspan="6">' + notes + '</td></tr>' : '');
    });
    $('#profitPeriodBody').innerHTML = html.join('');
    const notes = [];
    if (result.basis === 'intake' && sections.completed) notes.push('Строка завершённых дней показывает состояние на конец периода. В верхних карточках также учтены более поздние сдачи по тем же заказам.');
    if (sections.today) {
      notes.push('За сегодня показаны текущие начисления и внесённые расходы. Итог изменится при новых сдачах или добавлении расходов.');
      if (sections.today.ads === 0) notes.push('Чистый расход на рекламу за сегодня в реестре равен нулю. Полноту данных нужно сверить с отчётом рекламного кабинета.');
    }
    if (rows.length > 1 && fields.some(key => rows.reduce((sum, [part]) => sum + Math.round(part[key] * 100), 0) !== Math.round(result[key] * 100))) {
      if (result.basis !== 'intake') notes.push('Сумма строк отличается от общего итога. В расшифровке указаны операции, которые нельзя распределить между частями периода.');
    }
    $('#profitPeriodHint').textContent = notes.join(' ');
    $('#profitPeriodHint').hidden = !notes.length;
  }
  function render() {
    if (!owner() || !$('#profitMetrics')) return;
    const from = $('#profitFrom').value, to = $('#profitTo').value;
    if (!from || !to || from > to) { notice('Укажите период: начальная дата должна быть не позже конечной.', true); return; }
    if (typeof bridge()?.calculate !== 'function') { notice('Расчёт прибыли ещё загружается. Нажмите «Обновить».', true); return; }
    let result;try{result=bridge().calculate(from,to,state.expenses,$('#profitBasis').value)}catch(e){notice(e.message,true);return}
    const provisional = !!result.periodSections?.today || Number(result.salaryEstimated)>0 || (result.issues||result.warnings||[]).length>0;
    const cards = [[$('#profitBasis').value==='intake'?'Касса заявок':'Касса поступлений', result.companyCash, $('#profitBasis').value==='intake'?'Заявки, принятые в выбранный период':'Деньги, сданные в выбранный период', 'blue'], ['Зарплата диспетчеров', result.salary, `По расчёту ${money(result.salaryConfirmed)} · предварительно ${money(result.salaryEstimated)}`, 'violet'], ['Реклама', result.ads, 'С учётом возвратов', 'amber'], ['Прочие расходы', result.other, 'Активные операции периода', 'amber'], [provisional ? 'Прибыль · предварительно' : 'Прибыль', result.profit, 'Касса − зарплата − расходы', Number(result.profit) < 0 ? 'red' : 'green']];
    $('#profitMetrics').innerHTML = cards.map(([title, value, hint, color]) => `<div class="profit-metric ${color}"><span>${title}</span><strong>${value == null ? '—' : money(value)}</strong><small>${hint}</small></div>`).join('');
    renderPeriodSections(result);
    const issues = result.issues || [];
    $('#profitCalculationNote').textContent = issues.length ? issues.map(x => typeof x === 'string' ? x : x.message || 'Требуется сверка').join(' · ') : 'Выплата мастеру уже учтена в кассе компании и повторно не вычитается.';
    $('#profitCalculationNote').className = 'notice ' + (issues.length ? 'warn' : '');
    const expandedDays = new Set(Array.from($('#profitDays').querySelectorAll('details[open]'), detail => detail.dataset.day));
    const undivided = state.expenses.filter(e => e.active !== false && e.periodFrom && e.periodTo && e.periodFrom !== e.periodTo);
    $('#profitDays').innerHTML = [...(result.days || [])].sort((a,b) => b.date.localeCompare(a.date)).map(d => {
      const costs = d.salary + d.ads + d.other;
      const hasPeriodCost = undivided.some(e => e.periodFrom <= d.date && d.date <= e.periodTo);
      const margin = d.cash > 0 && !hasPeriodCost ? (100 * d.profit / d.cash).toLocaleString('ru-RU', {maximumFractionDigits:1}) + ' %' : '—';
      const tone = d.profit < 0 ? 'loss' : d.profit > 0 ? 'gain' : '';
      const breakdown = [['Зарплата',d.salary],['Реклама',d.ads],['Прочие',d.other]].map(([label,amount]) => `<div><dt>${label}</dt><dd>${money(amount)}</dd></div>`).join('');
      const contacts=state.contacts?.[d.date];
      const knownAds=!hasPeriodCost && state.expenses.some(e=>e.active!==false && e.date===d.date && (e.source==='avito'||/реклам|авито/i.test(e.category||'')));
      const price=count=>knownAds && count>0?money(d.ads/count):'—';
      return `<tr><th scope="row">${esc(d.date.split('-').reverse().join('.'))}</th><td>${money(d.cash)}</td><td><details data-day="${esc(d.date)}"${expandedDays.has(d.date) ? ' open' : ''}><summary aria-label="Расходы за ${esc(d.date)}">${money(costs)}</summary><dl>${breakdown}</dl></details></td><td><b class="day-result ${tone}">${money(d.profit)}</b></td><td>${margin}${hasPeriodCost ? '<small>Расход за период</small>' : ''}</td><td>${price(contacts)}<small><button type="button" class="btn small" data-contacts="${esc(d.date)}">Контакты: ${contacts??'ввести'}</button></small></td><td>${price(d.accepted)}<small>Заявок: ${d.accepted||0}</small></td><td>${d.checkCount?money(d.checkCents/100/d.checkCount):'—'}<small>С чеком: ${d.checkCount||0}</small></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">Нет операций за период.</td></tr>';
    $('#profitDays').querySelectorAll('[data-contacts]').forEach(button=>button.onclick=()=>action(button,async()=>{
      const date=button.dataset.contacts, previous=state.contacts?.[date]??null;
      const input=window.prompt('Сколько обращений поступило за '+date+'? Введите итог за весь день.',previous===null?'':String(previous));
      if(input===null)return;
      if(!/^\d{1,7}$/.test(input.trim())||Number(input)>1000000)throw new Error('Введите целое число от 0 до 1 000 000.');
      const data=await api('set_daily_contacts',{date,previous,count:Number(input)});
      state.contacts=data.contacts;render();notice('Количество обращений сохранено.');
    }));
    $('#profitStaff').innerHTML=(result.staff||[]).map(person=>`<tr><td><strong>${esc(person.name||person.person||'Сотрудник')}</strong></td><td class="num">${esc(Array.isArray(person.days)?person.days.length:person.days??'—')}</td><td class="num">${money(person.confirmed)}</td><td class="num">${money(person.estimated)}</td><td class="num"><strong>${money(person.total)}</strong></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Начислений сотрудникам за период нет.</td></tr>';
    const rows = state.expenses.filter(x => x.periodFrom&&x.periodTo ? x.periodFrom<=to&&x.periodTo>=from : x.date >= from && x.date <= to).sort((a,b) => String(b.date).localeCompare(String(a.date)));
    $('#profitExpenseBody').innerHTML = rows.length ? rows.map(x => `<tr class="${x.active === false ? 'profit-void' : ''}"><td>${x.periodFrom&&x.periodTo?`${esc(x.periodFrom)} — ${esc(x.periodTo)}<small>Расход за период, не за один день</small>`:esc(x.date)}</td><td>${esc(x.category || 'Расход')}</td><td>${esc(x.note || '—')}<small>${esc(x.externalId || '')}</small></td><td>${x.source === 'avito' ? 'Авито' : x.source === 'legacy' ? 'Ранее учтено' : 'Вручную'}</td><td class="num">${money((x.kind === 'refund' ? -1 : 1) * Number(x.amountCents) / 100)}</td><td>${x.active === false ? 'Исключено' : 'Учтено'}</td><td><button class="btn small" data-profit-void="${esc(x.id)}" data-active="${x.active === false ? 'true' : 'false'}">${x.active === false ? 'Восстановить' : 'Исключить'}</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">За выбранный период расходов нет.</td></tr>';
    $('#profitExpenseBody').querySelectorAll('[data-profit-void]').forEach(button => button.onclick = () => action(button, async () => {
      const data = await api('void', { id: button.dataset.profitVoid, active: button.dataset.active === 'true' });
      if (Array.isArray(data.expenses)) state.expenses = data.expenses; else state.expenses = (await api('list')).expenses || [];
      bridge().setExpenses?.(state.expenses);render(); notice(button.dataset.active === 'true' ? 'Операция восстановлена в расчёте.' : 'Операция исключена. Её можно восстановить.');
    }));
  }
  async function refresh() { const data=await api('list'); state.contacts=data.contacts||{}; state.expenses=data.expenses||[]; bridge().setExpenses?.(state.expenses); bridge().setReports?.(data.shiftReports||[],!!data.reportsTruncated); render(); if(data.reportsTruncated)notice('Получена только часть отчётов смен. Итог прибыли требует сверки.',true); }
  function importIssue(issue) {
    if(typeof issue==='string')return 'Проверьте строку исходной таблицы.';
    const labels={ambiguous_operation_type:'Уточните тип: списание или возврат. Пополнение баланса не является расходом.',conflicting_operation_id:'Номер операции повторяется с разными данными. Сверьте исходную таблицу.',unsafe_operation_id:'Номер операции распознан неточно. Укажите его текстом в исходной таблице.',ambiguous_amount:'Сумма неоднозначна. Проверьте разделители и выбранный столбец.',ambiguous_debit_credit:'Одновременно указаны списание и возврат. Уточните тип операции.',invalid_amount:'Некорректная сумма.',missing_amount:'Не указана сумма.',invalid_date:'Некорректная дата.',missing_date:'Не указана дата.',invalid_row:'Проверьте дату, сумму и номер операции.'};
    return labels[issue.code||issue.error]||issue.message||'Проверьте дату, сумму и тип операции.';
  }
  function mapping() {
    const result = { headerRow: Number($('#profitHeaderRow').value) - 1 };
    for (const key of ['date','amount','expense','income','description','operationId','type']) { const value = $('#profitMap_' + key).value; if (value !== '') result[key] = Number(value); }
    return result;
  }
  function updateImportButton() {
    const button = $('#profitImportConfirm');
    if (button) { button.disabled = state.busy || !state.selected.size || !$('#profitImportConsent')?.checked || state.parsed?.requiresMapping || state.parsed?.requiresPeriod; button.textContent = `Добавить выбранные расходы (${state.selected.size})`; }
  }
  function preview() {
    if (!window.AvitoProfit) { notice('Модуль чтения таблиц недоступен. Обновите страницу.', true); return; }
    if(state.statistics&&!$('#profitAccount').value.trim()){notice('Укажите название или номер кабинета Авито для сверки повторных периодов.',true);return;}
    state.parsed = state.statistics ? window.AvitoProfit.parseStatistics(state.raw,{from:$('#avitoPeriodFrom').value,to:$('#avitoPeriodTo').value,account:$('#profitAccount').value.trim()}) : window.AvitoProfit.parseRows(state.raw, mapping()); state.selected.clear();
    if(state.parsed.requiresMapping||state.parsed.requiresPeriod||(state.statistics&&(state.parsed.issues||[]).length&&!(state.parsed.rows||[]).length)) { $('#avitoPreview').hidden=true; notice(state.statistics?'Укажите подтверждённый период статистики. Даты публикации объявлений не используются.':'Выберите столбцы даты и суммы. Строки пока не готовы к загрузке.',true); updateImportButton(); return; }
    $('#profitImportConsent').checked = false;$('#avitoSelectAll').checked=false;
    const rows = state.parsed.rows || [];
    $('#avitoPreviewBody').innerHTML = rows.map((r,i) => `<tr><td><input type="checkbox" aria-label="Добавить строку ${esc(r.sourceRow || i+1)}" data-profit-row="${i}"></td><td>${esc(r.sourceRow || i+1)}</td><td>${r.periodFrom&&r.periodTo?`${esc(r.periodFrom)} — ${esc(r.periodTo)}`:esc(r.date)}</td><td class="num">${money(r.amount)}</td><td>${esc(r.description || '—')}</td><td>${esc(r.operationId || '—')}</td></tr>`).join('');
    const errors = state.parsed.errors || [];
    $('#avitoPreviewSummary').textContent = `Распознано: ${rows.length}. Сумма расходов с учётом возвратов: ${money(state.parsed.summary?.total||0)}. Ошибок: ${errors.length}. Пропущено: ${Array.isArray(state.parsed.skipped) ? state.parsed.skipped.length : state.parsed.skipped || 0}. Пополнения баланса не являются расходами. Выберите только списания и возвраты, которые нужно учесть.`;
    if(state.statistics)$('#avitoPreviewSummary').textContent += ` Это расходы за весь указанный период, будут учтены один раз на его последнюю дату, без распределения по дням. Бонусы: ${money(state.parsed.summary?.bonus||state.parsed.summary?.bonuses||0)} — показаны отдельно и не вычитаются дополнительно. Нельзя сравнивать кассу части месяца с рекламой за полный месяц.`;
    $('#avitoPreviewErrors').textContent = errors.map(x => typeof x === 'string' ? x : `Строка ${x.sourceRow || x.row || '—'}: ${importIssue(x)}`).join('\n');
    $('#avitoPreview').hidden = false;
    $('#avitoPreviewBody').querySelectorAll('[data-profit-row]').forEach(box => box.onchange = () => { const i=Number(box.dataset.profitRow); box.checked ? state.selected.add(i) : state.selected.delete(i); updateImportButton(); });
    updateImportButton();
  }
  function loadSheet() {
    const sheet = state.workbook.Sheets[$('#profitSheet').value];
    const safeSheet={...sheet};for(const [address,cell] of Object.entries(sheet)){if(address.startsWith('!')||!cell||typeof cell!=='object')continue;if(cell.f&&(cell.v==null||cell.v==='')){const display=window.AvitoProfit.hyperlinkDisplay?.(cell.f);if(display!=null)safeSheet[address]={...cell,v:display,t:'s'};}}
    state.raw = state.xlsx.utils.sheet_to_json(safeSheet, { header: 1, defval: '', raw: true });
    state.statistics=!!window.AvitoProfit.detectStatistics?.(state.raw)?.isStatistics;
    $('#avitoStatisticsPeriod').hidden=!state.statistics;$('#profitAccount').required=state.statistics;
    $('#avitoColumnMapping').hidden=state.statistics;
    if(state.statistics){const period=window.AvitoProfit.filenamePeriod?.(state.source)||{};$('#avitoPeriodFrom').value=period.from||'';$('#avitoPeriodTo').value=period.to||'';}
    const detected = window.AvitoProfit.detectColumns(state.raw);
    $('#profitHeaderRow').value = Number(detected.headerRow || 0) + 1;
    const header = state.raw[Number(detected.headerRow || 0)] || [];
    for (const key of ['date','amount','expense','income','description','operationId','type']) {
      const select = $('#profitMap_' + key);
      select.innerHTML = '<option value="">Не выбрано</option>' + header.map((v,i) => `<option value="${i}">${i+1}. ${esc(v || 'Без названия')}</option>`).join('');
      const value = detected.mapping?.[key]; select.value = Number.isInteger(value) ? String(value) : '';
    }
    $('#profitMapping').hidden = false; $('#avitoPreview').hidden = true; state.parsed = null; state.selected.clear();
    notice(state.statistics ? 'Это статистика объявлений за период. Укажите и подтвердите период файла: учитывается только «Расходы на объявления». Даты публикации и снятия не являются датами расходов.' : detected.requiresMapping ? 'Уточните столбцы даты и суммы, затем проверьте строки.' : 'Столбцы распознаны. Выберите один режим: общая сумма либо отдельные списания и возвраты. Затем нажмите «Показать строки».');
  }
  function mount() {
    if (!bridge() || !owner() || $('#profitPanel')) return;
    const tabs = $('.tabs'), anchor = $('[data-panel="finance"]'); if (!tabs || !anchor) return;
    const tab = document.createElement('button'); tab.type='button'; tab.className='tab'; tab.dataset.tab='profit'; tab.textContent='Финансы · Авито'; const oldTab=$('[data-tab="finance"]'); if(oldTab){oldTab.before(tab);oldTab.hidden=true;}else tabs.append(tab); anchor.hidden=true;
    const panel = document.createElement('section'); panel.id='profitPanel'; panel.className='section'; panel.dataset.panel='profit';
    panel.innerHTML = `<style>
#profitPanel .card.pad{padding:clamp(10px,1.2vw,18px)}
#profitPanel summary{cursor:pointer;font-weight:650}
#profitPeriodSections thead th:not(:first-child){text-align:right}
#profitPanel .profit-daily table{table-layout:fixed!important}
#profitPanel .profit-daily dl{max-width:16rem;margin-inline-start:auto!important;line-height:1.55;color:#213850;background:#eff4fa;border-radius:6px;padding:5px 8px}
#profitPanel .profit-daily summary:focus-visible{outline:2px solid #3763ac;outline-offset:2px}
#profitPanel .profit-daily .table-wrap{overflow-x:auto}
#profitPanel .profit-daily table{width:100%;min-width:32rem;table-layout:auto;font-variant-numeric:tabular-nums}
#profitPanel .profit-daily :is(th,td){text-align:right;padding:7px 12px;vertical-align:top;white-space:nowrap}
#profitPanel .profit-daily th:first-child{text-align:left}
#profitPanel .profit-daily tbody th{font-weight:500;background:transparent;position:static}
#profitPanel .profit-daily td summary{display:list-item;text-align:right}
#profitPanel .profit-daily dl{margin:8px 0 0;font-size:.88em}
#profitPanel .profit-daily dl div{display:flex;gap:10px;justify-content:space-between}
#profitPanel .profit-daily dd{margin:0}
#profitPanel .day-result{padding:2px 6px;border-radius:5px}
#profitPanel .day-result.gain{background:#d8f3e7;color:#11563d}
#profitPanel .day-result.loss{background:#ffe1df;color:#882823}
#profitPanel .profit-daily small{display:block}
@media(max-width:640px){#profitPanel .profit-daily :is(th,td){padding:6px}#profitPanel .profit-daily table{min-width:29rem}}
</style><div class="card pad profit-head"><div><h2>Прибыль</h2><p class="muted">Касса компании, зарплата и расходы — в одном расчёте</p></div><div class="profit-period"><label>Основание расчёта<select id="profitBasis" class="select"><option value="cash">По дате сдачи денег</option><option value="intake">По дате приёма заявки</option></select></label><label>С<input id="profitFrom" class="input" type="date"></label><label>По<input id="profitTo" class="input" type="date"></label><button class="btn primary" id="profitRefresh">Обновить</button></div></div><div id="profitNotice" class="notice" role="status" hidden></div><div id="profitMetrics" class="profit-metrics"></div><div id="profitCalculationNote" class="notice"></div><section id="profitPeriodSections" class="card pad" hidden><h3>Прибыль по датам</h3><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Период</th><th>Касса</th><th>Зарплата</th><th>Реклама</th><th>Прочие расходы</th><th>Прибыль</th></tr></thead><tbody id="profitPeriodBody"></tbody></table></div><p id="profitPeriodHint" class="muted"></p></section><div class="card pad profit-daily"><details open><summary>Расчёт по дням</summary><p class="muted">Доход — касса компании. Нажмите на расходы для разбивки. Цена контакта и заявки — реклама за день, делённая на число обращений или всех принятых заявок. Средний чек — по выполненным заказам с указанной суммой, по дате приёма. Нажмите число контактов для ввода.</p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Дата</th><th>Доход</th><th>Расходы</th><th>Прибыль</th><th>Маржа</th><th>Цена контакта</th><th>Цена заявки</th><th>Средний чек</th></tr></thead><tbody id="profitDays"></tbody></table></div></details></div><div class="card pad"><details><summary>Зарплата по сотрудникам</summary><p class="muted">Ставка относится ко дню приёма заказа. В кассовом режиме доплата попадает в день сдачи денег. Выданная зарплата уже учтена в начислениях.</p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Сотрудник</th><th>Дней</th><th>Завершённые дни</th><th>Предварительно</th><th>Всего начислено</th></tr></thead><tbody id="profitStaff"></tbody></table></div></details></div><div class="card pad"><details><summary>Добавить расход вручную</summary><form id="profitManualForm" class="profit-mapping"><label>Дата<input id="profitManualDate" class="input" type="date" required></label><label>Категория<input id="profitManualCategory" class="input" value="Прочие" required></label><label>Сумма, ₽<input id="profitManualAmount" class="input" inputmode="decimal" required placeholder="0,00"></label><label>Описание<input id="profitManualNote" class="input" required></label><button id="profitManualSave" type="submit" class="btn primary">Добавить подтверждённый расход</button></form></details></div><div class="card pad profit-import"><details><summary>Расходы Авито из Excel</summary><p class="muted">Сначала проверьте строки. Загрузка файла сама по себе ничего не добавляет в расчёт.</p><input id="profitFile" type="file" accept=".xlsx,.xls,.csv"><div id="profitMapping" hidden><div class="profit-mapping"><label>Кабинет Авито<input id="profitAccount" class="input" placeholder="Название или номер кабинета"></label><label>Лист<select id="profitSheet" class="select"></select></label><div id="avitoColumnMapping"><label>Строка заголовков<input id="profitHeaderRow" class="input" type="number" min="1" value="1"></label>${[['date','Дата'],['amount','Общая сумма (один столбец)'],['expense','Списания (отдельный столбец)'],['income','Возвраты / поступления (отдельный столбец)'],['description','Описание'],['operationId','Номер операции'],['type','Тип операции']].map(([k,l])=>`<label>${l}<select id="profitMap_${k}" class="select"></select></label>`).join('')}</div></div><div id="avitoStatisticsPeriod" hidden><p class="notice warn">Статистика за период: используем только «Расходы на объявления». Бонусы не считаем дополнительным расходом. Итог периода не распределяется по дням.</p><div class="profit-period"><label>Начало периода<input id="avitoPeriodFrom" type="date" class="input"></label><label>Конец периода<input id="avitoPeriodTo" type="date" class="input"></label></div></div><button class="btn" id="avitoPreviewButton">Показать строки</button></div><div id="avitoPreview" hidden><p id="avitoPreviewSummary"></p><label class="profit-consent"><input type="checkbox" id="avitoSelectAll"> Выбрать все распознанные строки (до 1000)</label><p id="avitoPreviewErrors" class="profit-errors"></p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Выбрать</th><th>Строка</th><th>Дата</th><th>Сумма</th><th>Описание</th><th>Номер операции</th></tr></thead><tbody id="avitoPreviewBody"></tbody></table></div><label class="profit-consent"><input id="profitImportConsent" type="checkbox"> Подтверждаю выбранные строки: расходы уменьшают прибыль, возвраты увеличивают.</label><button id="profitImportConfirm" class="btn primary" disabled>Добавить выбранные расходы (0)</button></div></details></div><div class="card pad"><details><summary>Учтённые расходы</summary><p class="muted">Повторные операции проверяются сервером. Исключение обратимо и сохраняет историю.</p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Источник</th><th>Сумма</th><th>Состояние</th><th>Действие</th></tr></thead><tbody id="profitExpenseBody"></tbody></table></div></details></div>`;
    const reconciliation=document.createElement('div');reconciliation.className='card pad';
    reconciliation.innerHTML='<details><summary>Сверка с исходной таблицей</summary><p class="muted">JSON-план исправляет только существующие заказы. Сервер сравнит прежние значения: если заказ изменился, строка будет отклонена. Каждое изменение сохраняется в журнале.</p><input id="reconcileFile" type="file" accept=".json,application/json"><div id="reconcilePreview" class="table-wrap" hidden></div><label class="profit-consent"><input id="reconcileConsent" type="checkbox"> Подтверждаю показанный план сверки с исходной таблицей</label><button id="reconcileApply" type="button" class="btn primary" disabled>Применить проверенный план</button><p id="reconcileResult" role="status"></p><button id="reconcileReload" type="button" class="btn" hidden>Обновить данные CRM</button></details>';
    panel.append(reconciliation);
    anchor.after(panel);
    const today = moscowDate();
    $('#profitFrom').value=today.slice(0,8)+'01'; $('#profitTo').value=today;
    tab.onclick=()=>{ if (!owner()) return; if (bridge().openTab) bridge().openTab('profit'); else { document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab)); document.querySelectorAll('.section').forEach(x=>x.classList.toggle('active',x===panel)); } action($('#profitRefresh'),refresh); };
    let patchPlan=null;
    $('#reconcileFile').onchange=async()=>{
      patchPlan=null;$('#reconcileApply').disabled=true;$('#reconcileConsent').checked=false;$('#reconcilePreview').hidden=true;
      try{const file=$('#reconcileFile').files[0];if(!file)return;if(file.size>800000)throw new Error('План слишком большой. Разделите его на части до 200 заказов.');
        const plan=JSON.parse(await file.text());
        if(plan.version!==1||!Array.isArray(plan.patches)||!plan.patches.length||plan.patches.length>200)throw new Error('Ожидается план версии 1, содержащий от 1 до 200 исправлений.');
        const allowed=['closeDate','companyShare','dispatcher','_status','masterAmount','total','parts','cleanCheck','pp','_duplicateOf','_cashClosedOn','_autoFinance','_cashReceipts','_cashRefunds'];const ids=new Set();
        for(const p of plan.patches){if(!p||!p.orderId||ids.has(p.orderId)||!p.before||!p.after||!p.sourceSpreadsheet||!Number.isInteger(p.sourceRow)||p.sourceRow<1)throw new Error('В плане отсутствуют данные заказа/источника или повторяются номера.');ids.add(p.orderId);const a=Object.keys(p.after).sort(),b=Object.keys(p.before).sort();if(!a.length||JSON.stringify(a)!==JSON.stringify(b)||a.some(k=>!allowed.includes(k)))throw new Error('План содержит неподдерживаемые поля или отсутствуют точные прежние значения.');}
        patchPlan=plan;$('#reconcilePreview').innerHTML='<table class="table profit-table"><thead><tr><th>Заказ</th><th>Поле</th><th>Было</th><th>Будет</th><th>Источник</th></tr></thead><tbody>'+plan.patches.flatMap(p=>Object.keys(p.after).map(k=>`<tr><td>${esc(p.orderId)}</td><td>${esc(({closeDate:'Дата сдачи',companyShare:'Касса',masterAmount:'Мастеру',total:'Сумма заказа',parts:'Запчасти',cleanCheck:'Чистый чек',pp:'ПП',_cashReceipts:'Сдача частями',_cashRefunds:'Возвраты клиенту',_duplicateOf:'Дубль заказа',_cashClosedOn:'Дата подтверждённой сдачи',_autoFinance:'Автоматический пересчёт',dispatcher:'Диспетчер',_status:'Статус'})[k])}</td><td>${esc(fieldPreview(k,p.before[k]))}</td><td>${esc(fieldPreview(k,p.after[k]))}</td><td>${esc(p.sourceSpreadsheet)} · строка ${esc(p.sourceRow)}</td></tr>`)).join('')+'</tbody></table>';$('#reconcilePreview').hidden=false;
      }catch(e){notice(e instanceof SyntaxError?'Не удалось прочитать JSON-план.':e.message,true);}
    };
    $('#reconcileConsent').onchange=()=>$('#reconcileApply').disabled=!patchPlan||!$('#reconcileConsent').checked;
    $('#reconcileApply').onclick=()=>action($('#reconcileApply'),async()=>{
      if(!patchPlan||!$('#reconcileConsent').checked)return;
      const result=await api('reconcile',{patches:patchPlan.patches});
      $('#reconcileResult').textContent=`Исправлено: ${(result.applied||[]).length}. Конфликтов: ${(result.conflicts||[]).length}. `+(result.conflicts||[]).map(x=>`${x.orderId}: ${x.reason==='before_mismatch'?'заказ уже изменён':x.reason==='not_found'?'заказ не найден':'не удалось сохранить'}`).join('; ');
      patchPlan=null;$('#reconcileConsent').checked=false;$('#reconcileReload').hidden=false;$('#reconcileApply').disabled=true;
    });
    $('#reconcileReload').onclick=()=>location.reload();
    $('#profitManualDate').value=today;
    let manualId='';
    $('#profitManualForm').addEventListener('input',()=>{if(!state.busy)manualId='';});
    $('#profitManualForm').onsubmit=e=>{e.preventDefault();action($('#profitManualSave'),async()=>{const amount=Number($('#profitManualAmount').value.replace(/\s/g,'').replace(',','.'));if(!(amount>0))throw new Error('Введите сумму расхода больше нуля.');if(!manualId)manualId=crypto.randomUUID();const row=expensePayload({date:$('#profitManualDate').value,amount,operationId:manualId,description:$('#profitManualNote').value});row.source='manual';row.category=$('#profitManualCategory').value.trim()||'Прочие';const data=await api('import',{rows:[row]});state.expenses=data.expenses||[];bridge().setExpenses?.(state.expenses);manualId='';$('#profitManualAmount').value='';$('#profitManualNote').value='';render();notice('Расход сохранён в общей базе.');});};
    $('#profitRefresh').onclick=()=>action($('#profitRefresh'),refresh);
    for(const id of ['profitFrom','profitTo','profitBasis']) $('#'+id).onchange=render;
    $('#profitFile').onchange=()=>action($('#avitoPreviewButton'),async()=>{
      const file=$('#profitFile').files[0]; if(!file)return;
      state.parsed=null;state.selected.clear();$('#avitoPreview').hidden=true;$('#profitMapping').hidden=true;
      if(file.size>20*1024*1024)throw new Error('Файл слишком большой. Максимальный размер — 20 МБ.');
      state.xlsx=await bridge().ensureXLSX(); if(!window.AvitoProfit||!state.xlsx)throw new Error('Не удалось загрузить модуль Excel.');
      state.workbook=state.xlsx.read(await file.arrayBuffer(),{type:'array'});state.source=file.name;
      $('#profitSheet').innerHTML=state.workbook.SheetNames.map(x=>`<option>${esc(x)}</option>`).join('');loadSheet();
    });
    $('#profitSheet').onchange=loadSheet; $('#avitoPreviewButton').onclick=()=>{try{preview()}catch(e){notice(e.message,true)}};
    $('#profitHeaderRow').addEventListener('change',()=>{const header=state.raw[Number($('#profitHeaderRow').value)-1]||[];for(const key of ['date','amount','expense','income','description','operationId','type'])$('#profitMap_'+key).innerHTML='<option value="">Не выбрано</option>'+header.map((v,i)=>`<option value="${i}">${i+1}. ${esc(v||'Без названия')}</option>`).join('');});
    $('#avitoSelectAll').onchange=()=>{state.selected.clear();$('#avitoPreviewBody').querySelectorAll('[data-profit-row]').forEach((box,i)=>{box.checked=$('#avitoSelectAll').checked&&i<1000;if(box.checked)state.selected.add(Number(box.dataset.profitRow));});updateImportButton();};
    $('#profitImportConsent').onchange=updateImportButton;
    for(const el of document.querySelectorAll('#profitMapping select,#profitMapping input')) if(el.id!=='profitSheet')el.addEventListener('change',()=>{state.parsed=null;state.selected.clear();$('#avitoPreview').hidden=true;updateImportButton();});
    $('#profitImportConfirm').onclick=()=>action($('#profitImportConfirm'),async()=>{
      if(!$('#profitImportConsent').checked||!state.parsed||!state.selected.size)return;
      if(state.selected.size>1000)throw new Error('Можно добавить не более 1000 строк за один раз.');
      const rows=[...state.selected].map(i=>state.parsed.rows[i]).map(r=>expensePayload(r,$('#profitAccount').value));
      const result=await api('import',{rows});state.expenses=result.expenses||[];bridge().setExpenses?.(state.expenses);state.selected.clear();$('#avitoPreview').hidden=true;render();notice(`Добавлено: ${result.inserted||0}. Уже были учтены: ${result.duplicates||0}. Сверено с дневными расходами B2BHelp: ${result.covered||0}.`);
    });
    if(anchor.classList.contains('active'))tab.onclick();
  }
  function sessionCheck() {
    if(!owner()) {const p=$('#profitPanel'),t=$('[data-tab="profit"]');if(p)p.remove();if(t)t.remove();state.expenses=[];state.parsed=null;state.selected.clear();return;}
    mount();const oldTab=$('[data-tab="finance"]');if(oldTab)oldTab.hidden=true;const oldPanel=$('[data-panel="finance"]');if(oldPanel)oldPanel.hidden=true;
  }
  window.addEventListener('masterai:session',sessionCheck);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sessionCheck,{once:true});else sessionCheck();
  setInterval(sessionCheck,1000);
  setInterval(()=>{if(owner()&&$('#profitPanel')?.classList.contains('active')&&!state.busy)action($('#profitRefresh'),refresh);},30000);
})();
