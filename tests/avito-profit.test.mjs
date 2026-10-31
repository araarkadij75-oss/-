import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../hosted-snapshot/avito-profit.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(code,context);const api=context.AvitoProfit;
const plain=value=>JSON.parse(JSON.stringify(value));
const head=['Дата операции','Сумма, руб.','Описание','Номер операции','Тип операции'];

test('UMD exports in browser and CommonJS without dependencies',()=>{
 assert.equal(typeof api.parseRows,'function');const c=vm.createContext({module:{exports:{}}});vm.runInContext(code,c);assert.equal(typeof c.module.exports.detectColumns,'function');
});
test('Russian numbers, currency, thousands, decimal cents and refunds',()=>{
 for(const [v,n] of [['1\u00a0234,56 ₽',1234.56],['12 345 руб.',12345],['(250,50)',-250.5],['−120,35',-120.35],['1,234.56',1234.56],['1.234,56',1234.56],[0,0],[1.005,1.01]])assert.equal(api.parseMoney(v).value,n,String(v));
});
test('ambiguous separator, foreign currencies, malformed grouping and missing amount are not guessed',()=>{
 for(const v of ['1,234','1.234','1 23','12abc34','10 USD','',Infinity])assert.ok(api.parseMoney(v).error,String(v));
});
test('dates parse Russian, ISO, explicit timestamps and Excel serial without timezone shift',()=>{
 for(const [v,n] of [['31.10.2026','2026-10-31'],['2026-10-31T23:00:00-05:00','2026-10-31'],['31/10/2026 09:30','2026-10-31'],[46326.75,'2026-10-31'],[1,'1900-01-01'],[59,'1900-02-28'],[61,'1900-03-01']])assert.equal(api.parseDate(v).value,n,String(v));
});
test('invalid and missing-year dates stay errors; Excel phantom day rejected',()=>{
 for(const v of ['31.02.2026','29.02.2025','31.10','31.10.26','2026-13-01',60,NaN,''])assert.ok(api.parseDate(v).error,String(v));assert.equal(api.parseDate('29.02.2024').value,'2024-02-29');
});
test('detects header below report title and maps exact money not balance',()=>{
 const d=api.detectColumns([['Отчёт Авито'],['Период: октябрь'],['Дата','Описание','Остаток','Сумма','ID операции']]);
 assert.equal(d.headerRow,2);assert.equal(d.mapping.amount,3);assert.equal(d.mapping.operationId,4);assert.equal(d.requiresMapping,false);
});
test('two dates or amount modes require explicit mapping',()=>{
 for(const h of [['Дата операции','Дата оплаты','Сумма'],['Дата','Сумма','Стоимость'],['Дата','Сумма','Расход']])assert.equal(api.detectColumns([h]).requiresMapping,true);
 const p=api.parseRows([['Дата','Дата оплаты','Сумма'],['31.10.2026','01.11.2026',100]],{headerRow:0,date:0,amount:2});assert.equal(p.rows[0].date,'2026-10-31');
});
test('unrecognized headers require mapping; supplied positions work without header',()=>{
 assert.equal(api.parseRows([['31.10.2026',100]]).requiresMapping,true);
 const p=api.parseRows([['31.10.2026',100]],{headerRow:-1,date:0,amount:1});assert.equal(p.rows.length,1);assert.equal(p.rows[0].sourceRow,1);
});
test('mapping rejects overlapping columns and fractional indexes',()=>{
 assert.equal(api.parseRows([head],{headerRow:0,date:0,amount:0}).requiresMapping,true);
 assert.equal(api.parseRows([head],{headerRow:0,date:0,amount:1.2}).requiresMapping,true);
});
test('blank, total and repeated header rows do not become expenses',()=>{
 const p=api.parseRows([head,['31.10.2026',100,'Продвижение','1'],[],['Итого',100],head,['31.10.2026',20,'Публикация','2']]);assert.equal(p.rows.length,2);assert.equal(p.summary.total,120);assert.deepEqual(plain(p.skipped.map(x=>x.reason)),['blank','total','repeated_header']);
});
test('missing dates and invalid money are flagged with source row',()=>{
 const p=api.parseRows([head,['',100,'Продвижение'],['31.02.2026',100],['31.10.2026','???']]);assert.equal(p.rows.length,0);assert.deepEqual(plain(p.errors.map(e=>[e.sourceRow,e.code])),[[2,'missing_date'],[3,'invalid_date'],[4,'invalid_amount']]);
});
test('refunds and credits become negative, negative debit signs do not invert expense',()=>{
 const p=api.parseRows([head,['31.10.2026',100,'Услуга','1','Списание'],['31.10.2026',25,'Возврат за услугу','2','Возврат'],['31.10.2026',-30,'Услуга','3','Списание'],['31.10.2026',-10,'Возврат комиссии','4','']]);
 assert.deepEqual(plain(p.rows.map(r=>r.amount)),[100,-25,30,-10]);assert.equal(p.summary.total,95);assert.equal(p.summary.expenses,130);assert.equal(p.summary.credits,35);
});
test('separate debit and credit columns supported; simultaneous nonzero fields quarantined',()=>{
 const p=api.parseRows([['Дата','Расход','Доход','Описание'],['31.10.2026','100','','Услуга'],['31.10.2026','','30','Возврат'],['31.10.2026',20,10,'Неясно']]);assert.equal(p.rows.length,2);assert.equal(p.summary.total,70);assert.equal(p.errors[0].code,'ambiguous_debit_credit');
});
test('same operation ID deduplicates exact repeated exports',()=>{
 const matrix=[head,['31.10.2026',100,'Услуга','op1'],['31.10.2026',100,'Услуга','op1']];const a=api.parseRows(matrix),b=api.parseRows(matrix);assert.equal(a.rows.length,1);assert.equal(a.skipped[0].reason,'duplicate_operation');assert.equal(a.rows[0].key,b.rows[0].key);
});
test('conflicting operation ID quarantines both, not first-wins or double-count',()=>{
 const p=api.parseRows([head,['31.10.2026',100,'Услуга','op1'],['31.10.2026',200,'Услуга','op1']]);assert.equal(p.rows.length,0);assert.equal(p.errors[0].code,'conflicting_operation_id');assert.equal(p.summary.total,0);
});
test('missing IDs use occurrence-based multiset keys; exact re-upload is idempotent',()=>{
 const matrix=[head,['31.10.2026',100,'Услуга'],['31.10.2026',100,' УСЛУГА '],['31.10.2026',20,'Другая']];const a=api.parseRows(matrix),b=api.parseRows(matrix);assert.equal(new Set(a.rows.map(r=>r.key)).size,3);assert.deepEqual(plain(a.rows.map(r=>r.key)),plain(b.rows.map(r=>r.key)));assert.equal(a.summary.total,220);
});
test('multiset keys do not depend on row numbers or file name',()=>{
 const a=api.parseRows([head,['31.10.2026',100,'Услуга'],['30.10.2026',20,'Другая']]);const b=api.parseRows([['Преамбула'],head,['30.10.2026',20,'Другая'],['31.10.2026',100,'Услуга']]);assert.deepEqual(plain(a.rows.map(r=>r.key).sort()),plain(b.rows.map(r=>r.key).sort()));
});
test('cent arithmetic avoids floating-point drift and daily totals reconcile',()=>{
 const s=api.summarize([{date:'2026-10-31',amount:.1},{date:'2026-10-31',amount:.2},{date:'2026-10-30',amount:-.1},{date:'bad',amount:100}]);assert.equal(s.total,.2);assert.equal(s.expenses,.3);assert.equal(s.credits,.1);assert.equal(s.invalidCount,1);assert.equal(s.byDate[0].date,'2026-10-30');assert.equal(s.byDate[1].total,.3);
});
test('empty input gives mapping issue, empty summary is zero not NaN',()=>{
 assert.equal(api.parseRows([]).requiresMapping,true);assert.equal(api.detectColumns(null).requiresMapping,true);assert.equal(api.summarize([]).total,0);
});
test('dated totals excluded and mere refund mention in spending text does not become credit',()=>{
 const p=api.parseRows([head,['31.10.2026',100,'Итого за день'],['31.10.2026',20,'Продвижение объявления о возврате']]);assert.equal(p.rows.length,1);assert.equal(p.rows[0].amount,20);
});
test('unsafe numeric operation IDs cannot silently collide after Excel rounding',()=>{
 const p=api.parseRows([head,['31.10.2026',100,'Услуга',9007199254740992]]);assert.equal(p.rows.length,0);assert.equal(p.errors[0].code,'unsafe_operation_id');
});
test('summary groups equivalent calendar dates and mapping outside file is rejected',()=>{
 const s=api.summarize([{date:'31.10.2026',amount:10},{date:'2026-10-31',amount:20}]);assert.equal(s.byDate.length,1);assert.equal(s.byDate[0].total,30);assert.equal(api.parseRows([head],{headerRow:10,date:0,amount:1}).requiresMapping,true);
});
test('balance funding is neither expense nor refund and cannot increase profit',()=>{
 for(const label of ['Пополнение баланса','Deposit','Top-up','Внесение средств']){
  const p=api.parseRows([head,['31.10.2026',5000,label,'1']]);assert.equal(p.rows.length,0,label);assert.equal(p.summary.total,0);assert.equal(p.skipped[0].reason,'balance_topup');
 }
 const p=api.parseRows([head,['31.10.2026',5000,'Через карту','1','Пополнение']]);assert.equal(p.skipped[0].reason,'balance_topup');
 const payment=api.parseRows([head,['31.10.2026',5000,'Пополнение баланса','1','Оплата']]);assert.equal(payment.skipped[0].reason,'balance_topup');
});
test('unclassified credit and negative amount require classification rather than becoming profit',()=>{
 for(const type of ['Зачисление','Доход','Income','Credit']){const p=api.parseRows([head,['31.10.2026',5000,'Перевод','1',type]]);assert.equal(p.rows.length,0);assert.equal(p.errors[0].code,'ambiguous_operation_type');}
 const p=api.parseRows([head,['31.10.2026',-200,'Коррекция']]);assert.equal(p.rows.length,0);assert.equal(p.errors[0].code,'ambiguous_operation_type');
});
test('credit columns require refund evidence; dedicated refund header is explicit evidence',()=>{
 const bad=api.parseRows([['Дата','Расход','Доход','Описание'],['31.10.2026','',100,'Перевод']]);assert.equal(bad.rows.length,0);assert.equal(bad.errors[0].code,'ambiguous_operation_type');
 const good=api.parseRows([['Дата','Расход','Возврат'],['31.10.2026','',100]]);assert.equal(good.rows[0].amount,-100);
 const deposit=api.parseRows([['Дата','Расход','Доход','Описание'],['31.10.2026','',5000,'Пополнение баланса']]);assert.equal(deposit.rows.length,0);assert.equal(deposit.skipped[0].reason,'balance_topup');
 const debitRefund=api.parseRows([['Дата','Расход','Описание'],['31.10.2026',-100,'Возврат за услугу']]);assert.equal(debitRefund.rows[0].amount,-100);
});

const statisticsHeader=['Номер объявления','Название объявления','Дата первой публикации','Дата снятия с публикации','Расходы на объявления','Списано бонусов на объявления','Расходы на размещение и целевые действия','Расходы на продвижение','Остальные расходы'];
const statisticsRows=[statisticsHeader,['12345678','Объявление А','2025-08-11','2026-11-01',1000,50,1000,0,0],['23456789','Объявление Б','2026-01-01','2026-11-12',500,20,500,0,0]];
test('Avito statistics recognized by exact total header, never treated as dated transactions',()=>{
 const detected=api.detectStatistics(statisticsRows);assert.equal(detected.isStatistics,true);assert.equal(detected.mapping.amount,4);assert.equal(detected.mapping.bonus,5);
 const ledger=api.parseRows(statisticsRows,{headerRow:0,date:2,amount:4});assert.equal(ledger.requiresStatisticsPeriod,true);assert.equal(ledger.rows.length,0);
});
test('statistics total uses only primary expense column and keeps bonuses separate',()=>{
 const p=api.parseStatistics(statisticsRows,{from:'2026-10-01',to:'2026-10-31',account:'main'});assert.equal(p.rows.length,2);assert.equal(p.summary.total,1500);assert.equal(p.summary.bonus,70);assert.equal(p.summary.expenses,1500);assert.equal(p.rows[0].date,'2026-10-31');assert.equal(p.rows[0].dateBasis,'period_end');assert.equal(p.rows[0].periodFrom,'2026-10-01');assert.equal(p.rows[0].statisticId,'12345678');assert.ok(p.rows[0].externalId.includes('2026-10-01:2026-10-31'));
});
test('publication/removal dates cannot supply missing statistics period',()=>{
 for(const o of [{},{from:'2026-11-01',to:'2026-10-31'},{from:'2026-02-30',to:'2026-10-31'}]){const p=api.parseStatistics(statisticsRows,o);assert.equal(p.rows.length,0);assert.equal(p.requiresPeriod,true);}
});
test('filename period accepts only explicit valid dates and preserves range boundaries',()=>{
 const p=api.filenamePeriod('Статистика_с_2026-10-01_по_2026-10-31.xlsx');assert.equal(p.from,'2026-10-01');assert.equal(p.to,'2026-10-31');assert.equal(p.error,null);
 assert.equal(api.filenamePeriod('Статистика_с_2026-10-01_по_2026-10-31 (1).xlsx').error,null);
 for(const f of ['Статистика.xlsx','Статистика_с_2026-11-01_по_2026-10-31.xlsx','Статистика_с_2026-02-30_по_2026-10-31.xlsx'])assert.ok(api.filenamePeriod(f).error);
});
test('HYPERLINK display extraction supports literal strings only and never evaluates expressions',()=>{
 assert.equal(api.hyperlinkDisplay('HYPERLINK("https://example.test/123","123")'),'123');assert.equal(api.hyperlinkDisplay('=HYPERLINK("https://example.test";"Название ""А""")'),'Название "А"');
 for(const f of ['SUM(A1:A2)','HYPERLINK(A1,"123")','HYPERLINK("url",A2)','HYPERLINK("url",CONCAT("1","2"))'])assert.equal(api.hyperlinkDisplay(f),null);
});
test('statistics keys preserve repeated upload and distinguish periods and accounts',()=>{
 const a=api.parseStatistics(statisticsRows,{from:'2026-10-01',to:'2026-10-31',account:'a'}),b=api.parseStatistics(statisticsRows,{from:'2026-10-01',to:'2026-10-31',account:'a'}),c=api.parseStatistics(statisticsRows,{from:'2026-10-01',to:'2026-10-30',account:'a'}),d=api.parseStatistics(statisticsRows,{from:'2026-10-01',to:'2026-10-31',account:'b'});assert.equal(a.rows[0].key,b.rows[0].key);assert.notEqual(a.rows[0].key,c.rows[0].key);assert.notEqual(a.rows[0].key,d.rows[0].key);assert.equal(a.rows[0].statisticId,c.rows[0].statisticId);
});
test('statistics duplicate ads counted once, changed repeated ad quarantined',()=>{
 const rows=[...statisticsRows,statisticsRows[1],['Итого','','','',1500]];const p=api.parseStatistics(rows,{from:'2026-10-01',to:'2026-10-31'});assert.equal(p.rows.length,2);assert.equal(p.summary.total,1500);assert.deepEqual(plain(p.skipped.map(r=>r.reason)),['duplicate_statistics_ad','total']);
 const conflict=api.parseStatistics([...statisticsRows,['12345678','А','','',1200,50]],{from:'2026-10-01',to:'2026-10-31'});assert.equal(conflict.rows.length,1);assert.equal(conflict.errors[0].code,'conflicting_statistics_ad');
});
test('statistics missing adID or bad bonus fails row instead of inventing financial data',()=>{
 const p=api.parseStatistics([statisticsHeader,['','Название','','',100,0],['123','Название','','',100,'invalid']],{from:'2026-10-01',to:'2026-10-31'});assert.equal(p.rows.length,0);assert.deepEqual(plain(p.errors.map(e=>e.code)),['invalid_statistics_ad_id','invalid_amount']);
});
test('component-only statistics never substituted for total or silently added',()=>{
 const d=api.detectStatistics([['Номер объявления','Расходы на продвижение'],['123',100]]);assert.equal(d.isStatistics,false);
 const dup=api.detectStatistics([['Номер объявления','Расходы на объявления','Расходы на объявления']]);assert.equal(dup.requiresMapping,true);
});
test('zero spend rows do not enter selectable import; nonzero bonus with zero expense requires review',()=>{
 const stats=api.parseStatistics([statisticsHeader,['123','Zero','','',0,0],['456','Bonus only','','',0,100],['789','Cost','','',100,0]],{from:'2026-10-01',to:'2026-10-31'});assert.equal(stats.rows.length,1);assert.equal(stats.rows[0].amount,100);assert.equal(stats.skipped[0].reason,'zero_expense');assert.equal(stats.errors[0].code,'zero_expense_with_bonus');
 const ledger=api.parseRows([head,['31.10.2026',0,'Бесплатная услуга','0'],['31.10.2026',100,'Услуга','1']]);assert.equal(ledger.rows.length,1);assert.equal(ledger.skipped[0].reason,'zero_expense');
});
