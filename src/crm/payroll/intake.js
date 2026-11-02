/* CRM_UNIT:payrollIntakeSnapshot-v2 */
function payrollIntakeSnapshot(cutoff=today()){
 if(!window.PayrollIntakeAccounting)throw new Error('Модуль расчёта зарплаты не загружен');
 const {anchor,first}=payrollSchedule(),days=[],reports=uniqueShiftReports(state.shiftReports||[]).filter(payrollAccountingReport);
 for(let date=anchor;date&&date<=cutoff;){days.push({date,person:payrollScheduledShift(date,anchor,first)});const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);date=d.toISOString().slice(0,10)}
 for(const r of reports)if(r.date>=anchor&&r.date<=cutoff)days.push({date:r.date,person:payrollShiftKey(r)});
 const orders=(state.orders||[]).filter(r=>!r._duplicateOf).map(r=>({id:String(r.orderId||r._id||''),person:orderPayrollShift(r),intakeDate:iso(parseDate(r.callDate||'')),cashDate:shiftCashRecordedDate(r),cashCents:Math.round(num(r.companyShare)*100),closed:payrollOrderCashRecorded(r),duplicateOf:r._duplicateOf||''})).filter(r=>r.intakeDate>=anchor&&r.intakeDate<=cutoff);
 // Owner confirmed that all existing confirmed reports were paid. The cutover
 // is fixed: confirming a NEW report must never silently register a payment.
 const paidCutover='2026-11-02T10:59:27.607Z';
 const payments=reports.filter(r=>r.ownerConfirmed&&r.subjectMemberId&&r.closedAt&&r.closedAt<=paidCutover&&r.date>=anchor).map(r=>({id:r.id,person:payrollShiftKey(r),date:r.date,amountCents:Math.round(num(r.salary)*100)}));
 const result=window.PayrollIntakeAccounting.calculate({orders,days,payments,cutoff,snapshotDate:today()});
 return {...result,orders,payments,anchor,days:result.days.map(d=>({...d,earnedCents:d.entitlementCents}))};
}/* CRM_END:payrollIntakeSnapshot-v2 */

