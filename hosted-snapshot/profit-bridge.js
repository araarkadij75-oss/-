(() => {
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
  calculate(from,to,expenses){
   requireOwner();
   const start=parseDate(from),end=parseDate(to);if(!start||!end||from>to)throw new Error('Проверьте начало и конец периода');
   if((end-start)/86400000>731)throw new Error('Выберите период не более двух лет');
   const warnings=[];if(!completeReports)warnings.push('Отчёты смен ещё не загружены с сервера — результат неполный.');if(reportsTruncated)warnings.push('Загружена только часть отчётов смен. Итог неполный.');
   if(completeReports)state.shiftReports=completeReports;
   const limit=to<today()?to:today(),reports=uniqueShiftReports(completeReports||state.shiftReports).filter(payrollAccountingReport),schedule=payrollSchedule(),ledger=payrollSettlementLedger(schedule.anchor,schedule.first),salaries=[];
   let unknown=0,undated=0,invalid=0;const orders=state.orders.map(r=>{const closed=derivedStage(r)==='Выполнен'||!!(r._cashClosedAt||r._cashClosedOn);const date=shiftCashRecordedDate(r);if(closed&&!date)undated++;if(closed&&date>=from&&date<=limit&&!orderPayrollShift(r))unknown++;const raw=numMaybe(r.companyShare);if(closed&&date>=from&&date<=limit&&raw===null)invalid++;return{id:String(r.orderId||''),date,cash:raw===null?NaN:raw,closed:closed&&!['Отмена','Отказ'].includes(derivedStage(r))}});
   const byDay=new Map();for(const entry of ledger){if(entry.used)continue;const key=entry.who+'|'+entry.assignedDate;byDay.set(key,(byDay.get(key)||0)+Math.round(entry.cash*100))}
   for(const d=new Date(start);iso(d)<=limit;d.setUTCDate(d.getUTCDate()+1)){const date=iso(d),person=payrollScheduledShift(date,schedule.anchor,schedule.first);for(const who of ['sergey','artem']){const saved=reports.find(r=>r.date===date&&payrollShiftKey(r)===who);if(saved)salaries.push({date,person:who,amount:num(saved.salary),confirmed:true});else if(person===who)salaries.push({date,person:who,amount:shiftPayroll((byDay.get(who+'|'+date)||0)/100),confirmed:false})}}
   for(const r of reports){if(r.date>=from&&r.date<=limit&&!['sergey','artem'].includes(payrollShiftKey(r)))warnings.push('Отчёт без распознанной смены '+r.date+' — зарплата требует сверки.')}
   if(undated)warnings.push('Закрытых заказов без даты сдачи: '+undated+'. В период не распределены.');if(unknown)warnings.push('Заказов без распознанного диспетчера: '+unknown+'. Зарплата по ним требует сверки.');if(invalid)warnings.push('Заказов без суммы кассы: '+invalid+'.');
   if(salaries.some(s=>!s.confirmed))warnings.push('Незакрытые дни рассчитаны предварительно по графику 2/2, включая минимум за рабочий день.');
   return window.ProfitAccounting.calculate({from,to:limit,orders,salaries,expenses,warnings});
  }
 };
})();
