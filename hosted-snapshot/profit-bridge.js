window.installMasterAIProfitBridge = (dependencies) => {
 const {state,collectRecordedCash,payrollIntakeSnapshot,currentRole,ownerPreviewActive,ensureXLSX,switchTab,parseDate,iso,today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),uniqueShiftReports,payrollAccountingReport,payrollShiftKey,payrollSchedule,payrollSettlementLedger,payrollScheduledShift,shiftPayroll,shiftCashRecordedDate,derivedStage,numMaybe,num,orderPayrollShift}=dependencies;
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
   if(!['intake','cash'].includes(basis))throw new Error('Неизвестное основание периода');
   const current=today(),limit=to<current?to:current;
   if(from>limit)throw new Error('Период расчёта начинается в будущем');
   if(completeReports)state.shiftReports=completeReports;
   const reports=uniqueShiftReports(completeReports||state.shiftReports).filter(payrollAccountingReport);
   if(typeof collectRecordedCash!=='function')throw new Error('Модуль учёта кассы не загружен — прибыль не рассчитана');
   if(typeof payrollIntakeSnapshot!=='function')throw new Error('Модуль зарплаты не загружен — прибыль не рассчитана');
   // Intake is a cohort valued as of today. Cash is a dated flow through the report end.
   function calculateAt(cutoff){
    const recorded=collectRecordedCash(state.orders,{basis:basis==='intake'?'callDate':'closeDate',cutoff,from,to:limit}).filter(r=>basis!=='intake'||cutoff===current||r.cashDate||r.receiptDate||r.order?._cashReceipts?.length);
    const orders=recorded.map(r=>({id:r.id,date:r.date,cash:r.cashCents/100,closed:true,receiptDate:basis==='cash'?r.receiptDate:undefined}));
    const payroll=payrollIntakeSnapshot(cutoff,current);
    const dateOf=value=>{const d=parseDate(value||'');return d?iso(d):''};
    const byId=new Map();
    const source=state.orders.filter(r=>!r._duplicateOf).map(r=>{
     const intake=dateOf(r.callDate),cash=shiftCashRecordedDate(r)||'',closed=derivedStage(r)==='Выполнен'||!!(r._cashClosedAt||r._cashClosedOn);
     const split=Array.isArray(r._cashReceipts)&&r._cashReceipts.length>0;
     const rawDates=split?r._cashReceipts.map(e=>e?.date||''):[cash];
     const dates=rawDates.filter(d=>d&&dateOf(d)===d&&(!intake||d>=intake));
     const row={intake,cash,person:orderPayrollShift(r),amount:numMaybe(r.companyShare),closed,split,dates,uncertainDate:(closed||split)&&dates.length!==rawDates.length};
     const id=String(r.orderId||r._id||'');
     if(id){if(!byId.has(id))byId.set(id,[]);byId.get(id).push(row)}
     return row;
    });
    const paymentWarnings=new Set(['payments_not_loaded','invalid_payment','duplicate_payment_id','conflicting_payment_id','payment_overflow']);
    const allWarnings=payroll.warnings||[];
    const scopes=[];
    for(const w of allWarnings){
     if(paymentWarnings.has(w.code)||String(w.code).startsWith('duplicate_'))continue;
     // Undated receipts contribute their known amount to the intake entitlement.
     // Their missing dates and potential cash-period allocation are reported separately below.
     if(w.code==='missingcashdate')continue;
     if(w.code==='invalid_day'&&/^\d{4}-\d{2}-\d{2}$/.test(w.id)){
      scopes.push({intake:w.id,person:'',dates:[],base:true});continue;
     }
     const affected=byId.get(String(w.id));
     if(!affected){scopes.push({global:true});continue}
     for(const row of affected){
      const base=!row.person||w.code==='conflicting_order_id';
      if(row.intake&&row.intake>cutoff)continue;
      if(!base&&!row.uncertainDate&&row.dates.length&&row.dates.every(d=>d>cutoff))continue;
      scopes.push({...row,base});
     }
    }
    if(!allWarnings.length&&payroll.incomplete)scopes.push({global:true});
    const unknownReports=reports.filter(r=>!['sergey','artem'].includes(payrollShiftKey(r)));
    for(const r of unknownReports)scopes.push({intake:r.date,person:'',dates:[],base:true});
    function affectsEntry(scope,entry){
     if(scope.global)return true;
     const intake=entry.intakeDate||entry.date;
     if((scope.intake&&scope.intake!==intake)||(scope.person&&scope.person!==entry.person))return false;
     if(!scope.intake&&!scope.uncertainDate&&scope.dates.length&&scope.dates.every(d=>d<intake))return false;
     if(basis==='intake')return true;
     if(entry.kind==='daily_minimum')return !!scope.base;
     return !!scope.uncertainDate||scope.dates.some(d=>d<=entry.date);
    }
    function scopeInWindow(s,a,b){
     if(s.global)return true;
     if(basis==='intake')return s.intake?s.intake>=a&&s.intake<=b:!s.dates.length||s.dates.some(d=>d>=a);
     return (s.base&&(!s.intake||s.intake>=a&&s.intake<=b))||s.dates.some(d=>d>=a&&d<=b)||(s.uncertainDate&&(!s.intake||s.intake<=b));
    }
    const accruals=basis==='intake'?payroll.days.map(d=>({date:d.date,person:d.person,amountCents:d.entitlementCents})):payroll.events;
    const salaryDays=new Map();
    for(const entry of accruals){
     if(!entry.date||entry.date<from||entry.date>limit)continue;
     const key=entry.person+'|'+entry.date;
     const day=salaryDays.get(key)||{date:entry.date,person:entry.person,amountCents:0,confirmed:entry.date<current};
     day.amountCents+=entry.amountCents;
     if(scopes.some(s=>affectsEntry(s,entry)))day.confirmed=false;
     salaryDays.set(key,day);
    }
    const salaries=[...salaryDays.values()].map(d=>({...d,amount:d.amountCents/100}));
    function period(a,b){
     const warnings=[],inside=d=>!!d&&d>=a&&d<=b;
     if(!completeReports)warnings.push('Отчёты смен ещё не загружены с сервера — результат неполный.');
     if(reportsTruncated)warnings.push('Загружена только часть отчётов смен. Итог неполный.');
     if(payroll.anchor&&a<payroll.anchor)warnings.push('Период начинается раньше начала учёта зарплаты '+payroll.anchor+'. Касса до этой даты может входить в итог, но начисления за исходные дни не восстановлены; точная прибыль за весь период неизвестна.');
     if(basis==='cash'&&payroll.anchor&&recorded.some(r=>inside(r.date)&&r.intakeDate&&r.intakeDate<payroll.anchor))warnings.push('В кассе есть заявки, принятые до начала учёта зарплаты '+payroll.anchor+'. Доплаты по этим исходным дням не восстановлены; прибыль требует сверки.');
     const undatedIncrements=(payroll.events||[]).filter(e=>!e.date&&e.amountCents>0&&(!e.intakeDate||e.intakeDate<=b));
     if(basis==='cash'&&undatedIncrements.length)warnings.push('Доплата без известной даты сдачи: '+(undatedIncrements.reduce((n,e)=>n+e.amountCents,0)/100).toFixed(2)+' ₽. Точная дата доплаты неизвестна.');
     let undated=0,unknown=0,invalid=0,invalidDates=0,futureCash=0,missingIntake=0,unassignedIntake=0;
     for(const r of source){
      if(!r.person&&inside(r.intake))unassignedIntake++;
      if(!r.closed&&!r.split)continue;
      const insideBasis=basis==='intake'?inside(r.intake):r.dates.some(inside)||inside(r.cash);
      if(!r.intake&&r.amount>0&&(basis==='intake'?(!r.dates.length||r.dates.some(d=>d>=a)):insideBasis||r.uncertainDate))missingIntake++;
      if(!r.split&&!r.cash&&r.amount>0&&(basis==='intake'?inside(r.intake):!r.intake||r.intake<=b))undated++;
      if(!insideBasis)continue;
      if(r.amount>0&&!r.person)unknown++;
      if(r.amount===null)invalid++;
      if(!r.split&&r.cash&&r.uncertainDate)invalidDates++;
      if(r.dates.some(d=>d>current))futureCash++;
     }
     const provisional=salaries.some(s=>!s.confirmed&&inside(s.date));
     if(scopes.some(s=>scopeInWindow(s,a,b))||accruals.some(e=>inside(e.date)&&scopes.some(s=>affectsEntry(s,e))))warnings.push('Зарплата: заказы с неизвестным ответственным или некорректными данными требуют отдельной сверки.');
     for(const r of unknownReports)if(inside(r.date))warnings.push('Отчёт без распознанной смены '+r.date+' — зарплата требует сверки.');
     if(undated)warnings.push('Заявок с подтверждённой кассой, но без даты сдачи: '+undated+'. '+(basis==='cash'?'Без даты нельзя определить, какие поступления относятся к этому периоду.':cutoff<current?'Сдача исключена из исторического среза: дата поступления неизвестна.':'Касса учтена по дню приёма. Точная дата доплаты неизвестна.'));
     if(missingIntake)warnings.push('Заказов с кассой без даты приёма: '+missingIntake+'. Зарплату по исходному дню требуется сверить.');
     if(unassignedIntake)warnings.push('Принятых заявок без установленного диспетчера: '+unassignedIntake+'. По ним нельзя определить, кому начислить зарплату за день приёма.');
     if(unknown)warnings.push('Заказов с кассой без распознанного диспетчера: '+unknown+'. Зарплата по ним требует сверки.');
     if(invalid)warnings.push('Заказов без суммы кассы: '+invalid+'.');
     if(invalidDates)warnings.push('Заказов с противоречивой датой сдачи исключено: '+invalidDates+'. Исправьте дату перед расчётом.');
     if(futureCash)warnings.push('Будущая сдача ещё не включена в кассу: '+futureCash+'.');
     if(provisional)warnings.push('Текущий день и строки с замечаниями требуют сверки. Зарплата считается по дню приёма, выплаты повторно не вычитаются из прибыли.');
     return {from:a,to:b,asOf:cutoff,...window.ProfitAccounting.calculate({from:a,to:b,orders,salaries,expenses,warnings}),basis};
    }
    return period;
   }
   const mainCutoff=basis==='intake'?current:limit;
   const period=calculateAt(mainCutoff);
   const result=period(from,limit);
   const prior=new Date(current+'T00:00:00Z');prior.setUTCDate(prior.getUTCDate()-1);
   const completedEnd=limit<current?limit:prior.toISOString().slice(0,10);
   const completed=from>completedEnd?null:completedEnd===limit&&mainCutoff===limit?result:calculateAt(completedEnd)(from,completedEnd);
   return {...result,periodSections:{completed,today:limit<current?null:from===current?result:period(current,current)}};
  }
 };
};
