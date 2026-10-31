(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvitoProfit = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // All column indices and headerRow are zero-based. sourceRow is one-based.
  // Monetary convention: positive expense, negative credit/refund, always RUB.
  var text = function (value) { return value == null ? '' : String(value).replace(/\u00a0|\u202f/g, ' ').replace(/\s+/g, ' ').trim(); };
  var norm = function (value) { return text(value).toLowerCase().replace(/ё/g, 'е'); };
  var header = function (value) { return norm(value).replace(/[№#()\[\],.:;₽/\\_-]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var own = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
  var moneyFields = ['amount', 'expense', 'income'];
  var fields = ['date', 'amount', 'description', 'operationId', 'type', 'expense', 'income'];

  function parseMoney(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value * 100) > Number.MAX_SAFE_INTEGER) return { value: null, error: 'invalid_amount' };
      return { value: Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100, error: null };
    }
    var s = text(value), negative = false;
    if (!s) return { value: null, error: 'missing_amount' };
    s = s.replace(/\u2212/g, '-');
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
    s = s.replace(/\s*(?:₽|руб(?:лей|ля|ль)?\.?|rub|rur)\s*$/i, '').trim();
    if (/^[+-]/.test(s)) { if (negative) return { value: null, error: 'invalid_amount' }; negative = s[0] === '-'; s = s.slice(1); }
    if (!/^\d[\d .,]*$/.test(s)) return { value: null, error: 'invalid_amount' };
    // Spaces must form valid thousands groups, not accidentally concatenate cells.
    if (/ /.test(s) && !/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(s)) return { value: null, error: 'invalid_amount' };
    s = s.replace(/ /g, '');
    if (s.includes(',') && s.includes('.')) {
      if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
      else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      else return { value: null, error: 'ambiguous_amount' };
    } else {
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) return { value: null, error: 'ambiguous_amount' };
      s = s.replace(',', '.');
    }
    var result = parseMoney(Number(s) * (negative ? -1 : 1));
    return result;
  }

  function isoDate(year, month, day) {
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    var d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function parseDate(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Number.isFinite(value.getTime()) ? { value: isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()), error: null } : { value: null, error: 'invalid_date' };
    }
    if (typeof value === 'number') {
      var serial = Math.floor(value);
      if (!Number.isFinite(value) || serial < 1 || serial === 60 || serial > 2958465) return { value: null, error: 'invalid_date' };
      var d = new Date(Date.UTC(1899, 11, 31) + (serial > 60 ? serial - 1 : serial) * 86400000);
      return { value: d.toISOString().slice(0, 10), error: null };
    }
    var s = text(value), m;
    if (!s) return { value: null, error: 'missing_date' };
    // A timestamp's written calendar date is retained, without timezone shifting.
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/))) {
      var iso = isoDate(+m[1], +m[2], +m[3]); return { value: iso, error: iso ? null : 'invalid_date' };
    }
    if ((m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/))) {
      var ru = isoDate(+m[3], +m[2], +m[1]); return { value: ru, error: ru ? null : 'invalid_date' };
    }
    return { value: null, error: /^\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2})?$/.test(s) ? 'ambiguous_date' : 'invalid_date' };
  }

  function headerCandidates(row) {
    var out = {}; fields.forEach(function (f) { out[f] = []; });
    (row || []).forEach(function (value, index) {
      var h = header(value); if (!h) return;
      if (/^(?:дата(?: |$)|date(?: |$)|датаоперации$)/.test(h)) out.date.push(index);
      if (/^(?:описание|назначение|услуга|наименование|комментарий|description|details)(?: |$)/.test(h)) out.description.push(index);
      if (/^(?:(?:id|идентификатор|номер) (?:операции|транзакции|платежа)|operation id|transaction id|id операции|id)$/.test(h)) out.operationId.push(index);
      if (/^(?:тип(?: операции)?|вид операции|операция|operation type|type)$/.test(h)) out.type.push(index);
      if (/^(?:расход(?:ы)?|списан[оияе]*|списание|сумма списания|сумма расхода|debit|expense)(?: |$)/.test(h)) out.expense.push(index);
      else if (/^(?:возврат(?:ы)?|refund|доход(?:ы)?|зачислен[оияе]*|зачисление|поступлен[оияе]*|поступление|сумма поступления|credit|income)(?: |$)/.test(h)) out.income.push(index);
      else if (/^(?:сумма|стоимость|amount|оплачено)(?: |$)/.test(h) && !/(?:остаток|баланс|balance)/.test(h)) out.amount.push(index);
    });
    return out;
  }

  function detectColumns(rows) {
    if (!Array.isArray(rows)) return { headerRow: null, mapping: {}, candidates: {}, requiresMapping: true, issues: ['invalid_rows'] };
    var best = null;
    rows.slice(0, 40).forEach(function (row, index) {
      if (!Array.isArray(row)) return;
      var candidates = headerCandidates(row), hasMoney = moneyFields.some(function (f) { return candidates[f].length; });
      var score = (candidates.date.length ? 5 : 0) + (hasMoney ? 5 : 0) + ['description', 'operationId', 'type'].filter(function (f) { return candidates[f].length; }).length;
      if (!best || score > best.score) best = { score: score, headerRow: index, candidates: candidates };
    });
    if (!best || best.score < 10) return { headerRow: null, mapping: {}, candidates: best ? best.candidates : {}, requiresMapping: true, issues: ['header_not_found'] };
    var mapping = { headerRow: best.headerRow }, issues = [];
    fields.forEach(function (f) { var c = best.candidates[f]; if (c.length === 1) mapping[f] = c[0]; else if (c.length > 1) issues.push('ambiguous_' + f); });
    if (!own(mapping, 'date')) issues.push('date_column_required');
    if (!moneyFields.some(function (f) { return own(mapping, f); })) issues.push('amount_column_required');
    if (own(mapping, 'amount') && (own(mapping, 'expense') || own(mapping, 'income'))) issues.push('ambiguous_amount_mode');
    return { headerRow: best.headerRow, mapping: mapping, candidates: best.candidates, requiresMapping: issues.length > 0, issues: issues };
  }

  function operationType(value) {
    var v = norm(value);
    if (/^(?:deposit|top[ -]?up|replenish(?:ment)?)\b/.test(v) || /^(?:пополнен|внесение средств|внесено на баланс|перевод на баланс|оплата баланса)/.test(v)) return 'topup';
    if (/^refund\b/.test(v) || /^возврат/.test(v)) return 'refund';
    if (/^(?:credit|income)\b/.test(v) || /^(?:зачислен|поступлен|доход)/.test(v)) return 'ambiguous_income';
    if (/^(?:expense|debit|charge|payment)\b/.test(v) || /^(?:расход|списан|оплат)/.test(v)) return 'expense';
    return '';
  }

  function validateMapping(mapping) {
    var issues = [];
    if (!mapping || !Number.isInteger(mapping.headerRow) || mapping.headerRow < -1) issues.push('invalid_header_row');
    fields.forEach(function (f) { if (mapping && own(mapping, f) && mapping[f] !== null && (!Number.isInteger(mapping[f]) || mapping[f] < 0)) issues.push('invalid_' + f + '_column'); });
    if (!mapping || !Number.isInteger(mapping.date) || mapping.date < 0) issues.push('date_column_required');
    var modes = moneyFields.filter(function (f) { return mapping && Number.isInteger(mapping[f]) && mapping[f] >= 0; });
    if (!modes.length) issues.push('amount_column_required');
    if (modes.includes('amount') && modes.length > 1) issues.push('ambiguous_amount_mode');
    var used = fields.filter(function (f) { return mapping && Number.isInteger(mapping[f]) && mapping[f] >= 0; }).map(function (f) { return mapping[f]; });
    if (new Set(used).size !== used.length) issues.push('overlapping_columns');
    return issues;
  }

  function parseRows(matrix, suppliedMapping) {
    var detected = detectColumns(matrix), mapping = suppliedMapping ? Object.assign({}, suppliedMapping) : detected.mapping;
    if (suppliedMapping && !own(mapping, 'headerRow')) mapping.headerRow = detected.headerRow == null ? 0 : detected.headerRow;
    var issues = suppliedMapping ? validateMapping(mapping) : detected.issues;
    if (!Array.isArray(matrix)) issues = ['invalid_rows'];
    else if (suppliedMapping && mapping.headerRow >= matrix.length) issues.push('header_row_out_of_range');
    var result = { rows: [], errors: [], skipped: [], requiresMapping: issues.length > 0, mapping: mapping, issues: issues, detected: detected };
    if (issues.length) return result;
    var occurrences = new Map(), operations = new Map(), conflictedOperations = new Set();
    matrix.slice(mapping.headerRow + 1).forEach(function (raw, offset) {
      var sourceRow = mapping.headerRow + 2 + offset;
      if (!Array.isArray(raw)) { result.errors.push({ sourceRow: sourceRow, code: 'invalid_row' }); return; }
      var cell = function (f) { return Number.isInteger(mapping[f]) ? raw[mapping[f]] : ''; };
      if (raw.every(function (v) { return !text(v); })) { result.skipped.push({ sourceRow: sourceRow, reason: 'blank' }); return; }
      var description = text(cell('description')), operationId = text(cell('operationId'));
      var date = parseDate(cell('date'));
      var totalLabel = function (v) { return /^(?:итого|всего|общий итог|total|grand total)(?:\s|:|$)/i.test(text(v)); };
      if ((date.error && raw.some(totalLabel)) || totalLabel(description)) { result.skipped.push({ sourceRow: sourceRow, reason: 'total' }); return; }
      var hc = headerCandidates(raw);
      if (hc.date.includes(mapping.date) && moneyFields.some(function (f) { return hc[f].length; })) { result.skipped.push({ sourceRow: sourceRow, reason: 'repeated_header' }); return; }
      if (date.error) { result.errors.push({ sourceRow: sourceRow, code: date.error, field: 'date', value: cell('date') }); return; }
      if (typeof cell('operationId') === 'number' && !Number.isSafeInteger(cell('operationId'))) { result.errors.push({ sourceRow: sourceRow, code: 'unsafe_operation_id', field: 'operationId' }); return; }
      var amount, kind = 'expense', type = operationType(cell('type')), descriptionType = operationType(description);
      if (!type || type === 'ambiguous_income') {
        if (descriptionType) type = descriptionType;
      }
      if (type === 'topup' || descriptionType === 'topup') { result.skipped.push({ sourceRow: sourceRow, reason: 'balance_topup' }); return; }
      if (type === 'ambiguous_income') { result.errors.push({ sourceRow: sourceRow, code: 'ambiguous_operation_type', field: 'type' }); return; }
      if (Number.isInteger(mapping.amount)) {
        amount = parseMoney(cell('amount'));
        if (!amount.error && type) amount.value = Math.abs(amount.value) * (type === 'refund' ? -1 : 1);
        else if (!amount.error && amount.value < 0) amount.error = 'ambiguous_operation_type';
      } else {
        var debit = text(cell('expense')) ? parseMoney(cell('expense')) : { value: 0, error: null };
        var credit = text(cell('income')) ? parseMoney(cell('income')) : { value: 0, error: null };
        if (!text(cell('expense')) && !text(cell('income'))) amount = { error: 'missing_amount' };
        else if (debit.error || credit.error) amount = { error: debit.error || credit.error };
        else if (debit.value && credit.value) amount = { error: 'ambiguous_debit_credit' };
        else if (credit.value) {
          var incomeHeader = mapping.headerRow >= 0 ? operationType(matrix[mapping.headerRow][mapping.income]) : '';
          amount = type !== 'expense' && (type === 'refund' || incomeHeader === 'refund') ? { value: -Math.abs(credit.value), error: null } : { error: 'ambiguous_operation_type' };
        } else amount = { value: Math.abs(debit.value) * (type === 'refund' ? -1 : 1), error: null };
      }
      if (amount.error) { result.errors.push({ sourceRow: sourceRow, code: amount.error, field: 'amount' }); return; }
      if (amount.value < 0) kind = 'credit';
      var cents = Math.round(amount.value * 100), base = JSON.stringify([date.value, norm(description), cents]);
      var key;
      if (operationId) key = 'op:' + encodeURIComponent(operationId);
      else { var occurrence = (occurrences.get(base) || 0) + 1; occurrences.set(base, occurrence); key = 'row:' + encodeURIComponent(base) + ':' + occurrence; }
      var entry = { key: key, date: date.value, amount: cents / 100, description: description, operationId: operationId, kind: kind, sourceRow: sourceRow };
      if (operationId) {
        if (operations.has(key)) {
          var previous = operations.get(key);
          if (previous.date === entry.date && previous.amount === entry.amount && norm(previous.description) === norm(entry.description)) result.skipped.push({ sourceRow: sourceRow, reason: 'duplicate_operation', key: key });
          else { conflictedOperations.add(key); result.errors.push({ sourceRow: sourceRow, code: 'conflicting_operation_id', key: key, previousSourceRow: previous.sourceRow }); }
          return;
        }
        operations.set(key, entry);
      }
      result.rows.push(entry);
    });
    result.rows = result.rows.filter(function (r) { return !conflictedOperations.has(r.key); });
    result.summary = summarize(result.rows);
    return result;
  }

  function summarize(rows) {
    var cents = 0, expense = 0, credits = 0, count = 0, invalidCount = 0, days = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !Number.isFinite(r.amount) || !parseDate(r.date).value || Math.abs(r.amount * 100) > Number.MAX_SAFE_INTEGER) { invalidCount++; return; }
      var n = Math.round(r.amount * 100), date = parseDate(r.date).value; cents += n; if (n >= 0) expense += n; else credits -= n; count++;
      var d = days.get(date) || { date: date, count: 0, cents: 0, expenseCents: 0, creditCents: 0 };
      d.count++; d.cents += n; if (n >= 0) d.expenseCents += n; else d.creditCents -= n; days.set(date, d);
    });
    return { count: count, invalidCount: invalidCount, total: cents / 100, expenses: expense / 100, credits: credits / 100,
      byDate: Array.from(days.values()).sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (d) { return { date: d.date, count: d.count, total: d.cents / 100, expenses: d.expenseCents / 100, credits: d.creditCents / 100 }; }) };
  }

  return Object.freeze({ detectColumns: detectColumns, parseRows: parseRows, summarize: summarize, parseMoney: parseMoney, parseDate: parseDate });
});
