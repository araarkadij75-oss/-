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
   const limit=to<today()?to:today(),reports=uniqueShiftReports(completeReports||state.shiftReports).filter(payrollAccountingReport),schedule=payrollSchedule(),ledger=payrollSettlementLedger(schedule.anchor,schedule.first),salaries=[];
   if(!['intake','cash'].includes(basis))throw new Error('Неизвестное основание периода');
   let unknown=0,undated=0,invalid=0;const orders=state.orders.filter(r=>!r._duplicateOf).map(r=>{const stage=derivedStage(r),closed=stage==='Выполнен'||!!(r._cashClosedAt||r._cashClosedOn),cashDate=shiftCashRecordedDate(r),intakeDate=iso(parseDate(r.callDate||'')),date=basis==='intake'?intakeDate:cashDate,raw=numMaybe(r.companyShare),inside=date>=from&&date<=limit;if(closed&&!cashDate&&intakeDate>=from&&intakeDate<=limit&&raw>0)undated++;if(closed&&inside&&raw>0&&!orderPayrollShift(r))unknown++;if(closed&&inside&&raw===null)invalid++;return{id:String(r.orderId||''),date,cash:raw===null?NaN:raw,closed}});
   if(typeof payrollIntakeSnapshot!=='function')throw new Error('Модуль зарплаты не загружен — прибыль не рассчитана');
   const payroll=payrollIntakeSnapshot(today()),salaryDays=new Map();
   const accruals=basis==='intake'?payroll.days.map(d=>({date:d.date,person:d.person,amountCents:d.entitlementCents})):payroll.events;
   for(const entry of accruals){const key=entry.person+'|'+entry.date;salaryDays.set(key,{date:entry.date,person:entry.person,amountCents:(salaryDays.get(key)?.amountCents||0)+entry.amountCents})}
   for(const entry of salaryDays.values())salaries.push({date:entry.date,person:entry.person,amount:entry.amountCents/100,confirmed:!payroll.incomplete&&entry.date<today()});
   if(payroll.incomplete)warnings.push('Зарплата: есть заказы с неподтверждёнными датами или суммами; они не включены.');
   for(const r of reports){if(r.date>=from&&r.date<=limit&&!['sergey','artem'].includes(payrollShiftKey(r)))warnings.push('Отчёт без распознанной смены '+r.date+' — зарплата требует сверки.')}
   if(undated)warnings.push('Заявок этого периода с кассой, но без даты сдачи: '+undated+'. Касса заявок учитывается по дате звонка; распределение зарплаты по сменам требует даты сдачи.');if(unknown)warnings.push('Заказов с кассой без распознанного диспетчера: '+unknown+'. Зарплата по ним требует сверки.');if(invalid)warnings.push('Заказов без суммы кассы: '+invalid+'.');
   if(salaries.some(s=>!s.confirmed))warnings.push('Текущий день и строки с замечаниями требуют сверки. Зарплата считается по дню приёма, выплаты повторно не вычитаются из прибыли.');
   return {...window.ProfitAccounting.calculate({from,to:limit,orders,salaries,expenses,warnings}),basis};
  }
 };
};
