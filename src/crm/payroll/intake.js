/* CRM_UNIT:payrollIntakeSnapshot-v2 */
function payrollIntakeSnapshot(cutoff=today()){
 if(!window.PayrollIntakeAccounting)throw new Error('Модуль расчёта зарплаты не загружен');
 const {anchor}=payrollSchedule(),days=[],reports=uniqueShiftReports(state.shiftReports||[]).filter(payrollAccountingReport);
 // A planned calendar date alone is not evidence of a worked day.
 for(const r of state.orders||[]){if(r._duplicateOf)continue;const date=iso(parseDate(r.callDate||'')),person=orderPayrollShift(r);if(date>=anchor&&date<=cutoff&&['sergey','artem'].includes(person))days.push({date,person})}
 for(const r of reports)if(r.date>=anchor&&r.date<=cutoff)days.push({date:r.date,person:payrollShiftKey(r)});
 const orders=(state.orders||[]).filter(r=>!r._duplicateOf).map(r=>({id:String(r.orderId||r._id||''),person:orderPayrollShift(r),intakeDate:iso(parseDate(r.callDate||'')),cashDate:shiftCashRecordedDate(r),cashCents:Math.round(num(r.companyShare)*100),closed:payrollOrderCashRecorded(r),duplicateOf:r._duplicateOf||''})).filter(r=>r.intakeDate>=anchor&&r.intakeDate<=cutoff);
 // Owner confirmed that all existing confirmed reports were paid. The cutover
 // is fixed: confirming a NEW report must never silently register a payment.
 const paidCutover='2026-11-02T10:59:27.607Z';
 const payments=reports.filter(r=>r.ownerConfirmed&&r.subjectMemberId&&r.closedAt&&r.closedAt<=paidCutover&&r.date>=anchor).map(r=>({id:r.id,person:payrollShiftKey(r),date:r.date,amountCents:Math.round(num(r.salary)*100)}));
 const actor=window.MasterAICloud?.profile,actorKey=String(actor?.uid||actor?.id||''),ledgerReady=!!actorKey&&state.payrollPaymentsOwner===actorKey&&state.payrollPaymentsStatus==='loaded';
 if(ledgerReady)for(const p of state.payrollPayments||[])if(p.active!==false)payments.push({id:'payment:'+p.id,person:p.person,date:p.date,amountCents:p.amountCents});
 const result=window.PayrollIntakeAccounting.calculate({orders,days,payments,cutoff,snapshotDate:today()});
 if(!ledgerReady){result.warnings.push({code:'payments_not_loaded',id:''});result.incomplete=true;for(const p of result.people){p.dueCents=null;p.overpaidCents=null}}
 result.paymentsLoaded=ledgerReady;
 return {...result,orders,payments,anchor,days:result.days.map(d=>({...d,earnedCents:d.entitlementCents}))};
}/* CRM_END:payrollIntakeSnapshot-v2 */

