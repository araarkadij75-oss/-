(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const money = n => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(n) || 0);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
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
    if (!response.ok || data.ok !== true) throw new Error(({ 400:'Проверьте даты и суммы выбранных строк.', 403:'Для этого действия нужен вход владельца.', 409:'Найден конфликт: операция уже загружена с другими данными либо периоды статистики пересекаются. Не добавляйте статистику и отдельные операции одного кабинета за одинаковые даты.', 413:'Слишком много строк. Разделите загрузку на части до 1000 строк.' })[response.status] || 'Не удалось сохранить расходы. Попробуйте позже.');
    return data;
  }
  async function action(button, fn) {
    if (state.busy) return;
    state.busy = true; button.disabled = true;
    try { await fn(); } catch (e) { notice(e.message || 'Не удалось выполнить действие.', true); }
    finally { state.busy = false; button.disabled = button.id==='reconcileApply'&&!$('#reconcileConsent')?.checked; updateImportButton(); }
  }
  function render() {
    if (!owner() || !$('#profitMetrics')) return;
    const from = $('#profitFrom').value, to = $('#profitTo').value;
    if (!from || !to || from > to) { notice('Укажите период: начальная дата должна быть не позже конечной.', true); return; }
    if (typeof bridge()?.calculate !== 'function') { notice('Расчёт прибыли ещё загружается. Нажмите «Обновить».', true); return; }
    let result;try{result=bridge().calculate(from,to,state.expenses,$('#profitBasis').value)}catch(e){notice(e.message,true);return}
    const provisional = Number(result.salaryEstimated)>0 || (result.issues||result.warnings||[]).length>0;
    const cards = [[$('#profitBasis').value==='intake'?'Касса заявок':'Касса поступлений', result.companyCash, $('#profitBasis').value==='intake'?'Заявки, принятые в выбранный период':'Деньги, сданные в выбранный период', 'blue'], ['Зарплата диспетчеров', result.salary, `Подтверждено ${money(result.salaryConfirmed)} · предварительно ${money(result.salaryEstimated)}`, 'violet'], ['Реклама', result.ads, 'С учётом возвратов', 'amber'], ['Прочие расходы', result.other, 'Активные операции периода', 'amber'], [provisional ? 'Прибыль · предварительно' : 'Прибыль', result.profit, 'Касса − зарплата − расходы', Number(result.profit) < 0 ? 'red' : 'green']];
    $('#profitMetrics').innerHTML = cards.map(([title, value, hint, color]) => `<div class="profit-metric ${color}"><span>${title}</span><strong>${value == null ? '—' : money(value)}</strong><small>${hint}</small></div>`).join('');
    const issues = result.issues || [];
    $('#profitCalculationNote').textContent = issues.length ? issues.map(x => typeof x === 'string' ? x : x.message || 'Требуется сверка').join(' · ') : 'Выплата мастеру уже учтена в кассе компании и повторно не вычитается.';
    $('#profitCalculationNote').className = 'notice ' + (issues.length ? 'warn' : '');
    $('#profitDays').innerHTML=(result.days||[]).map(d=>`<tr><td>${esc(d.date)}</td>${['cash','salary','ads','other','profit'].map(k=>`<td class="num">${money(d[k])}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="6" class="empty">Нет операций за период.</td></tr>';
    $('#profitStaff').innerHTML=(result.staff||[]).map(person=>`<tr><td><strong>${esc(person.name||person.person||'Сотрудник')}</strong></td><td class="num">${esc(Array.isArray(person.days)?person.days.length:person.days??'—')}</td><td class="num">${money(person.confirmed)}</td><td class="num">${money(person.estimated)}</td><td class="num"><strong>${money(person.total)}</strong></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Начислений сотрудникам за период нет.</td></tr>';
    const rows = state.expenses.filter(x => x.periodFrom&&x.periodTo ? x.periodFrom<=to&&x.periodTo>=from : x.date >= from && x.date <= to).sort((a,b) => String(b.date).localeCompare(String(a.date)));
    $('#profitExpenseBody').innerHTML = rows.length ? rows.map(x => `<tr class="${x.active === false ? 'profit-void' : ''}"><td>${x.periodFrom&&x.periodTo?`${esc(x.periodFrom)} — ${esc(x.periodTo)}<small>Расход за период, не за один день</small>`:esc(x.date)}</td><td>${esc(x.category || 'Расход')}</td><td>${esc(x.note || '—')}<small>${esc(x.externalId || '')}</small></td><td>${x.source === 'avito' ? 'Авито' : x.source === 'legacy' ? 'Ранее учтено' : 'Вручную'}</td><td class="num">${money((x.kind === 'refund' ? -1 : 1) * Number(x.amountCents) / 100)}</td><td>${x.active === false ? 'Исключено' : 'Учтено'}</td><td><button class="btn small" data-profit-void="${esc(x.id)}" data-active="${x.active === false ? 'true' : 'false'}">${x.active === false ? 'Восстановить' : 'Исключить'}</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">За выбранный период расходов нет.</td></tr>';
    $('#profitExpenseBody').querySelectorAll('[data-profit-void]').forEach(button => button.onclick = () => action(button, async () => {
      const data = await api('void', { id: button.dataset.profitVoid, active: button.dataset.active === 'true' });
      if (Array.isArray(data.expenses)) state.expenses = data.expenses; else state.expenses = (await api('list')).expenses || [];
      bridge().setExpenses?.(state.expenses);render(); notice(button.dataset.active === 'true' ? 'Операция восстановлена в расчёте.' : 'Операция исключена. Её можно восстановить.');
    }));
  }
  async function refresh() { const data=await api('list'); state.expenses=data.expenses||[]; bridge().setExpenses?.(state.expenses); bridge().setReports?.(data.shiftReports||[],!!data.reportsTruncated); render(); if(data.reportsTruncated)notice('Получена только часть отчётов смен. Итог прибыли требует сверки.',true); }
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
    panel.innerHTML = `<div class="card pad profit-head"><div><h2>Прибыль</h2><p class="muted">Касса компании, зарплата и расходы — в одном расчёте</p></div><div class="profit-period"><label>Период по<select id="profitBasis" class="select"><option value="intake">Дате заявки (как в таблице)</option><option value="cash">Дате сдачи денег</option></select></label><label>С<input id="profitFrom" class="input" type="date"></label><label>По<input id="profitTo" class="input" type="date"></label><button class="btn primary" id="profitRefresh">Обновить</button></div></div><div id="profitNotice" class="notice" role="status" hidden></div><div id="profitMetrics" class="profit-metrics"></div><div id="profitCalculationNote" class="notice"></div><div class="card pad"><details><summary>Расчёт по дням</summary><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Дата</th><th>Касса</th><th>Зарплата</th><th>Реклама</th><th>Прочие</th><th>Прибыль</th></tr></thead><tbody id="profitDays"></tbody></table></div></details></div><div class="card pad"><details><summary>Зарплата по сотрудникам</summary><p class="muted">Подтверждённые смены и предварительные начисления показаны отдельно. Начисление не означает фактическую выплату.</p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Сотрудник</th><th>Дней</th><th>Подтверждено</th><th>Предварительно</th><th>Всего начислено</th></tr></thead><tbody id="profitStaff"></tbody></table></div></details></div><div class="card pad"><h3>Добавить расход вручную</h3><form id="profitManualForm" class="profit-mapping"><label>Дата<input id="profitManualDate" class="input" type="date" required></label><label>Категория<input id="profitManualCategory" class="input" value="Прочие" required></label><label>Сумма, ₽<input id="profitManualAmount" class="input" inputmode="decimal" required placeholder="0,00"></label><label>Описание<input id="profitManualNote" class="input" required></label><button id="profitManualSave" type="submit" class="btn primary">Добавить подтверждённый расход</button></form></div><div class="card pad profit-import"><h3>Расходы Авито из Excel</h3><p class="muted">Сначала проверьте строки. Загрузка файла сама по себе ничего не добавляет в расчёт.</p><input id="profitFile" type="file" accept=".xlsx,.xls,.csv"><div id="profitMapping" hidden><div class="profit-mapping"><label>Кабинет Авито<input id="profitAccount" class="input" placeholder="Название или номер кабинета"></label><label>Лист<select id="profitSheet" class="select"></select></label><div id="avitoColumnMapping"><label>Строка заголовков<input id="profitHeaderRow" class="input" type="number" min="1" value="1"></label>${[['date','Дата'],['amount','Общая сумма (один столбец)'],['expense','Списания (отдельный столбец)'],['income','Возвраты / поступления (отдельный столбец)'],['description','Описание'],['operationId','Номер операции'],['type','Тип операции']].map(([k,l])=>`<label>${l}<select id="profitMap_${k}" class="select"></select></label>`).join('')}</div></div><div id="avitoStatisticsPeriod" hidden><p class="notice warn">Статистика за период: используем только «Расходы на объявления». Бонусы не считаем дополнительным расходом. Итог периода не распределяется по дням.</p><div class="profit-period"><label>Начало периода<input id="avitoPeriodFrom" type="date" class="input"></label><label>Конец периода<input id="avitoPeriodTo" type="date" class="input"></label></div></div><button class="btn" id="avitoPreviewButton">Показать строки</button></div><div id="avitoPreview" hidden><p id="avitoPreviewSummary"></p><label class="profit-consent"><input type="checkbox" id="avitoSelectAll"> Выбрать все распознанные строки (до 1000)</label><p id="avitoPreviewErrors" class="profit-errors"></p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Выбрать</th><th>Строка</th><th>Дата</th><th>Сумма</th><th>Описание</th><th>Номер операции</th></tr></thead><tbody id="avitoPreviewBody"></tbody></table></div><label class="profit-consent"><input id="profitImportConsent" type="checkbox"> Подтверждаю выбранные строки: расходы уменьшают прибыль, возвраты увеличивают.</label><button id="profitImportConfirm" class="btn primary" disabled>Добавить выбранные расходы (0)</button></div></div><div class="card pad"><h3>Учтённые расходы</h3><p class="muted">Повторные операции проверяются сервером. Исключение обратимо и сохраняет историю.</p><div class="table-wrap"><table class="table profit-table"><thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Источник</th><th>Сумма</th><th>Состояние</th><th>Действие</th></tr></thead><tbody id="profitExpenseBody"></tbody></table></div></div>`;
    const reconciliation=document.createElement('div');reconciliation.className='card pad';
    reconciliation.innerHTML='<details><summary>Сверка с исходной таблицей</summary><p class="muted">JSON-план исправляет только существующие заказы. Сервер сравнит прежние значения: если заказ изменился, строка будет отклонена. Каждое изменение сохраняется в журнале.</p><input id="reconcileFile" type="file" accept=".json,application/json"><div id="reconcilePreview" class="table-wrap" hidden></div><label class="profit-consent"><input id="reconcileConsent" type="checkbox"> Подтверждаю показанный план сверки с исходной таблицей</label><button id="reconcileApply" type="button" class="btn primary" disabled>Применить проверенный план</button><p id="reconcileResult" role="status"></p><button id="reconcileReload" type="button" class="btn" hidden>Обновить данные CRM</button></details>';
    panel.append(reconciliation);
    anchor.after(panel);
    const now=new Date(), local=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    $('#profitFrom').value=local(new Date(now.getFullYear(),now.getMonth(),1)); $('#profitTo').value=local(now);
    tab.onclick=()=>{ if (!owner()) return; if (bridge().openTab) bridge().openTab('profit'); else { document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab)); document.querySelectorAll('.section').forEach(x=>x.classList.toggle('active',x===panel)); } action($('#profitRefresh'),refresh); };
    let patchPlan=null;
    $('#reconcileFile').onchange=async()=>{
      patchPlan=null;$('#reconcileApply').disabled=true;$('#reconcileConsent').checked=false;$('#reconcilePreview').hidden=true;
      try{const file=$('#reconcileFile').files[0];if(!file)return;if(file.size>800000)throw new Error('План слишком большой. Разделите его на части до 200 заказов.');
        const plan=JSON.parse(await file.text());
        if(plan.version!==1||!Array.isArray(plan.patches)||!plan.patches.length||plan.patches.length>200)throw new Error('Ожидается план версии 1, содержащий от 1 до 200 исправлений.');
        const allowed=['closeDate','companyShare','dispatcher','_status'];const ids=new Set();
        for(const p of plan.patches){if(!p||!p.orderId||ids.has(p.orderId)||!p.before||!p.after||!p.sourceSpreadsheet||!Number.isInteger(p.sourceRow)||p.sourceRow<1)throw new Error('В плане отсутствуют данные заказа/источника или повторяются номера.');ids.add(p.orderId);const a=Object.keys(p.after).sort(),b=Object.keys(p.before).sort();if(!a.length||JSON.stringify(a)!==JSON.stringify(b)||a.some(k=>!allowed.includes(k)))throw new Error('Разрешены только дата сдачи, касса, диспетчер и статус с точными прежними значениями.');}
        patchPlan=plan;$('#reconcilePreview').innerHTML='<table class="table profit-table"><thead><tr><th>Заказ</th><th>Поле</th><th>Было</th><th>Будет</th><th>Источник</th></tr></thead><tbody>'+plan.patches.flatMap(p=>Object.keys(p.after).map(k=>`<tr><td>${esc(p.orderId)}</td><td>${esc(({closeDate:'Дата сдачи',companyShare:'Касса',dispatcher:'Диспетчер',_status:'Статус'})[k])}</td><td>${esc(p.before[k]??'Поле отсутствует')}</td><td>${esc(p.after[k])}</td><td>${esc(p.sourceSpreadsheet)} · строка ${esc(p.sourceRow)}</td></tr>`)).join('')+'</tbody></table>';$('#reconcilePreview').hidden=false;
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
    $('#profitManualDate').value=local(now);
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
      const result=await api('import',{rows});state.expenses=result.expenses||[];bridge().setExpenses?.(state.expenses);state.selected.clear();$('#avitoPreview').hidden=true;render();notice(`Добавлено: ${result.inserted||0}. Уже были учтены: ${result.duplicates||0}.`);
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
