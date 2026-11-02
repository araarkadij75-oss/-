window.installMasterAIProfitBridge = (dependencies) => {
 const {state,payrollIntakeSnapshot,currentRole,ownerPreviewActive,ensureXLSX,switchTab,parseDate,iso,today,uniqueShiftReports,payrollAccountingReport,payrollShiftKey,payrollSchedule,payrollSettlementLedger,payrollScheduledShift,shiftPayroll,shiftCashRecordedDate,derivedStage,numMaybe,num,orderPayrollShift}=dependencies;
 'use strict';
 let completeReports=null,reportsTruncated=false;
 const owner=()=>currentRole()==='owner'&&!ownerPreviewActive()&&!!window.MasterAICloud?.connected;
 const requireOwner=()=>{if(!owner())throw new Error('Доступно только владельцу с подключённой сессией')};
 const clear=()=>{completeReports=null;reportsTruncated=false;if(!owner()){state.expenses=[]}};
 window.addEventListener('masterai:session',clear);
 window.MasterAIProfitBridge={
  snapshot:()=>owner()?({role:currentRole(),userrole:currentRole(),userRole:currentRole(),connected:!!window.MasterAICloud?.connected,orders:state.orders,shiftReports:completeReports||state.shiftReports,settings:state.settings,expenses:state.expenses}):({role:currentRole(),userRole:currentRole(),connected:!!window.MasterAICloud?.connected}),
  ensureXLSX:()=>ensureXLSX(),
  openTab:tab=>switchTab(tab),
  setReports:(reports,truncated=false)=>{requireOwner();completeReports=reports;reportsTruncated=truncated;state.shiftReports=reports},
  setExpenses:expenses=>{requireOwner();state.expenses=expenses.filter(x=>x.active!==false).map(x=>({...x,_id:x.id,amount:Math.abs(x.amountCents)/100*(x.kind==='refund'?-1:1)}))},
  calculate(from,to,expenses,basis='intake'){
   requireOwner();
   const start=parseDate(from),end=parseDate(to);if(!start||!end||from>to)throw new Error('Проверьте начало и конец периода');
   if((end-start)/86400000>731)throw new Error('Выберите период не более двух лет');
   const warnings=[];if(!completeReports)warnings.push('Отчёты смен ещё не загружены с сервера — результат неполный.');if(reportsTruncated)warnings.push('Загружена только часть отчётов смен. Итог неполный.');
   if(completeReports)state.shiftReports=completeReports;
   const limit=to<today()?to:today(),reports=uniqueShiftReports(completeReports||state.shiftReports).filter(payrollAccountingReport),salaries=[];
   if(!['intake','cash'].includes(basis))throw new Error('Неизвестное основание периода');
   let unknown=0,undated=0,invalid=0,invalidDates=0,futureCash=0;const orders=state.orders.filter(r=>!r._duplicateOf).map(r=>{const stage=derivedStage(r),closed=stage==='Выполнен'||!!(r._cashClosedAt||r._cashClosedOn),cashDate=shiftCashRecordedDate(r),intakeDate=iso(parseDate(r.callDate||'')),date=basis==='intake'?intakeDate:cashDate,raw=numMaybe(r.companyShare),inside=date>=from&&date<=limit;if(closed&&!cashDate&&intakeDate>=from&&intakeDate<=limit&&raw>0)undated++;if(closed&&inside&&raw>0&&!orderPayrollShift(r))unknown++;if(closed&&inside&&raw===null)invalid++;const parsedCash=cashDate?iso(parseDate(cashDate)):'';const badDate=!!cashDate&&(!parsedCash||parsedCash!==cashDate||(intakeDate&&cashDate<intakeDate)),future=!badDate&&!!cashDate&&cashDate>today();if(closed&&inside&&badDate)invalidDates++;if(closed&&inside&&future)futureCash++;return{id:String(r.orderId||''),date,cash:raw===null?NaN:raw,closed:closed&&!badDate&&!future}});
   if(typeof payrollIntakeSnapshot!=='function')throw new Error('Модуль зарплаты не загружен — прибыль не рассчитана');
   const payroll=payrollIntakeSnapshot(today()),salaryDays=new Map();
   const paymentWarnings=new Set(['payments_not_loaded','invalid_payment','duplicate_payment_id','conflicting_payment_id','payment_overflow']),allPayrollWarnings=payroll.warnings||[],accrualWarnings=allPayrollWarnings.filter(w=>!paymentWarnings.has(w.code)),accrualIncomplete=accrualWarnings.some(w=>!String(w.code).startsWith('duplicate_'))||(!allPayrollWarnings.length&&!!payroll.incomplete);
   const accruals=basis==='intake'?payroll.days.map(d=>({date:d.date,person:d.person,amountCents:d.entitlementCents})):payroll.events;
   for(const entry of accruals){const key=entry.person+'|'+entry.date;salaryDays.set(key,{date:entry.date,person:entry.person,amountCents:(salaryDays.get(key)?.amountCents||0)+entry.amountCents})}
   for(const entry of salaryDays.values())salaries.push({date:entry.date,person:entry.person,amount:entry.amountCents/100,confirmed:!accrualIncomplete&&entry.date<today()});
   if(accrualWarnings.some(w=>w.code!=='missingcashdate'))warnings.push('Зарплата: заказы с неизвестным ответственным или некорректными данными требуют отдельной сверки.');
   for(const r of reports){if(r.date>=from&&r.date<=limit&&!['sergey','artem'].includes(payrollShiftKey(r)))warnings.push('Отчёт без распознанной смены '+r.date+' — зарплата требует сверки.')}
   if(undated)warnings.push('Заявок этого периода с кассой, но без даты сдачи: '+undated+'. Подтверждённая касса включена в зарплату исходного дня приёма; точная дата возникновения доплаты неизвестна.');if(unknown)warnings.push('Заказов с кассой без распознанного диспетчера: '+unknown+'. Зарплата по ним требует сверки.');if(invalid)warnings.push('Заказов без суммы кассы: '+invalid+'.');
   if(invalidDates)warnings.push('Заказов с противоречивой датой сдачи исключено: '+invalidDates+'. Исправьте дату перед расчётом.');if(futureCash)warnings.push('Будущая сдача ещё не включена в кассу: '+futureCash+'.');
   if(salaries.some(s=>!s.confirmed&&s.date>=from&&s.date<=limit))warnings.push('Текущий день и строки с замечаниями требуют сверки. Зарплата считается по дню приёма, выплаты повторно не вычитаются из прибыли.');
   return {...window.ProfitAccounting.calculate({from,to:limit,orders,salaries,expenses,warnings}),basis};
  }
 };
};
