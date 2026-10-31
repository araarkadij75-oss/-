import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../hosted-snapshot/index.html',import.meta.url),'utf8');
const source=html.match(/function payrollCycleUiStatus\(c\)\{[^\n]+\}/)[0];
const status=vm.runInNewContext('('+source+')');
test('cycle distinguishes provisional and confirmed accrual without claiming payment',()=>{
 const pending={saved:null,salary:4500}; const confirmed={saved:4500,salary:4700};
 assert.match(status(pending),/Предварительно.*требует сверки/);
 assert.match(status(confirmed),/подтверждённых отчётах.*не отметка выплаты/);
 assert.match(status({saved:0}),/подтверждённых отчётах/);
 assert.deepEqual(pending,{saved:null,salary:4500});
 assert.deepEqual(confirmed,{saved:4500,salary:4700});
});
test('payroll navigation separates daily verification and two-day totals',()=>{
 assert.match(html,/data-tab="shiftclose">Проверка смен/);
 assert.match(html,/data-tab="payrollcycles">Зарплата · 2 дня/);
 assert.match(html,/Закрытые смены · расчёт по двухдневным циклам/);
 assert.match(html,/каждое начисление учитывается один раз/);
});
test('cycle details retain order actions and mark missing settlement date as unresolved',()=>{
 const body=html.slice(html.indexOf('function renderPayrollCycleRegister(){'),html.indexOf('function ',html.indexOf('function renderPayrollCycleRegister(){')+20));
 assert.match(body,/<details><summary>Заказы:/);
 assert.match(body,/· поздние:/);
 assert.match(body,/data-owner-shift-order/);
 assert.match(body,/Учтён в отчёте/);
 assert.match(body,/Требует проверки: нет даты сдачи/);
 assert.match(body,/c.saved===null\?c.salary:c.saved/);
});
