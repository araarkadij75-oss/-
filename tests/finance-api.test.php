<?php
declare(strict_types=1);
define('ELITESERVICE_FINANCE_LIBRARY', true);
require __DIR__ . '/../hosted-snapshot/crm-api/finance.php';
function fin_check(bool $ok, string $label): void { if (!$ok) throw new RuntimeException($label); }
function fin_reject(callable $fn, string $label): void { try { $fn(); } catch (InvalidArgumentException|DomainException $e) { return; } throw new RuntimeException($label); }
$row = ['date'=>'2026-10-31','amountCents'=>105050,'source'=>'avito','category'=>'Реклама','externalId'=>'operation-1','account'=>'account-1','note'=>'  One   operation  '];
$a=fin_normalize($row);
fin_check($a['note']==='One operation','Whitespace normalized');
fin_check(fin_id($a)===fin_id(fin_normalize($row+['ignored'=>'not identity'])),'Deterministic identity');
$changed=$row;$changed['amountCents']=900;
fin_check(fin_id($a)===fin_id(fin_normalize($changed)),'Changed financial values collide for same operation for conflict detection');
$other=$row;$other['account']='account-2';
fin_check(fin_id($a)!==fin_id(fin_normalize($other)),'Account namespaces external operation IDs');
foreach (['2026-02-30','31.10.2026','', '1999-01-01'] as $date) { $bad=$row;$bad['date']=$date;fin_reject(fn()=>fin_normalize($bad),'Invalid date accepted'); }
foreach ([0,-1,1.5,'100',100000000001] as $amount) { $bad=$row;$bad['amountCents']=$amount;fin_reject(fn()=>fin_normalize($bad),'Invalid cents accepted'); }
$bad=$row;$bad['source']='unknown';fin_reject(fn()=>fin_normalize($bad),'Unknown source accepted');
$refund=$row;$refund['kind']='refund';fin_check(fin_normalize($refund)['kind']==='refund','Refund is explicit');
foreach (['master','dispatcher_logistic','logistic',''] as $role) fin_reject(fn()=>fin_owner(['role'=>$role,'uid'=>'test']), 'Nonowner accepted');
fin_owner(['role'=>'owner','uid'=>'test']);
$source=file_get_contents(__DIR__.'/../hosted-snapshot/crm-api/finance.php');
fin_check(str_contains($source,'$actor = tg_jwt_actor($pdo);'),'JWT verified before dispatch');
fin_check(str_contains($source,"'finance_import'") && str_contains($source,'tg_write_many('),'Mutations audited');
fin_check(str_contains($source,'GET_LOCK(?,10)') && str_contains($source,'$pdo->beginTransaction()') && str_contains($source,'$pdo->rollBack()'),'Import serialized and atomic');
fin_check(str_contains($source,"'reportsTruncated' => \$truncated"),'Incomplete report read flagged');
echo "finance API validation and authorization contracts passed\n";

$payment=['op'=>'payroll_payments_add','idempotencyKey'=>'payment-request-000001','person'=>'sergey','date'=>'2026-11-02','amountCents'=>123450,'reference'=>'BANK-00001','note'=>'Actual new payment','legacyExcluded'=>true];
$owner=['role'=>'owner','uid'=>'owner-test'];$stamp='2026-11-03T10:00:00Z';
$plan=fin_payment_plan([],$owner,$payment,$stamp);$record=$plan['payment'];
fin_check($plan['changed'] && $record['active'] && $record['amountCents']===123450 && $record['createdBy']==='owner-test','Explicit new payment recorded');
$retry=fin_payment_plan([$record],$owner,$payment,$stamp);fin_check(!$retry['changed'] && $retry['duplicate'],'Same request retry is idempotent');
try{fin_payment_plan([$record],$owner,array_replace($payment,['amountCents'=>123451]),$stamp);throw new RuntimeException('Changed retry accepted');}catch(UnexpectedValueException $e){fin_check($e->getMessage()==='payment_conflict','Changed retry conflict');}
try{fin_payment_plan([$record],$owner,array_replace($payment,['idempotencyKey'=>'payment-request-000002','reference'=>'bank-00001']),$stamp);throw new RuntimeException('Same receipt doubled');}catch(UnexpectedValueException $e){fin_check($e->getMessage()==='payment_reference_exists','Semantic duplicate rejected');}
$void=fin_payment_plan([$record],$owner,['op'=>'payroll_payments_void','id'=>$record['id'],'reason'=>'Receipt cancelled'],$stamp);
fin_check($void['changed'] && !$void['payment']['active'] && $void['payment']['voidedBy']==='owner-test' && $void['payment']['amountCents']===123450,'Void preserves amount and audit');
$retryVoid=fin_payment_plan([$void['payment']],$owner,$payment,$stamp);fin_check(!$retryVoid['changed']&&!$retryVoid['payment']['active'],'Add retry never reactivates void');
$voidTwice=fin_payment_plan([$void['payment']],$owner,['op'=>'payroll_payments_void','id'=>$record['id'],'reason'=>'Retry'],$stamp);fin_check(!$voidTwice['changed']&&$voidTwice['payment']['voidReason']==='Receipt cancelled','Void retry preserves first audit');
foreach(['master','dispatcher_logistic','logistic',''] as $role)fin_reject(fn()=>fin_payment_plan([],['role'=>$role,'uid'=>'other'],$payment,$stamp),'Nonowner payment accepted');
foreach([['date'=>'2026-11-01'],['date'=>'2100-01-01'],['date'=>'2026-02-30'],['person'=>'unknown'],['amountCents'=>0],['amountCents'=>-1],['amountCents'=>1.5],['amountCents'=>'100'],['reference'=>''],['idempotencyKey'=>'short'],['legacyExcluded'=>false],['reportId'=>'legacy-paid'],['paidOrderIds'=>[]]] as $bad)fin_reject(fn()=>fin_payment_normalize(array_replace($payment,$bad)),'Invalid payment accepted');
fin_reject(fn()=>fin_payment_plan([$record],$owner,['op'=>'payroll_payments_void','id'=>$record['id'],'reason'=>''],$stamp),'Unexplained void accepted');
fin_check(str_contains($source,"'payroll_payment_recorded'")&&str_contains($source,"'payroll_payment_voided'"),'Payment mutations audited');
fin_check(str_contains($source,"'payroll:'.substr(hash('sha256',tg_workspace())")&&str_contains($source,'$existing=fin_payments_list($pdo,$actor);$plan=fin_payment_plan('),'Payment idempotency checked under workspace lock and transaction');
fin_check(str_contains($source,"'payroll_payments_list'")&&str_contains($source,"'payrollPayments'"),'Dedicated collection and endpoint');
echo "payroll payment API behavior passed\n";

$monthly=$row;$monthly['periodFrom']='2026-10-01';$monthly['periodTo']='2026-10-31';
fin_check(fin_normalize($monthly)['periodFrom']==='2026-10-01','Monthly period accepted');
fin_check(!array_key_exists('periodFrom',fin_normalize($row)),'Legacy rows remain unchanged');
foreach ([['2026-11-01','2026-10-31'],['2026-02-30','2026-10-31'],['2026-10-01','2026-10-30'],['2026-10-01',null]] as [$from,$to]) { $bad=$row;$bad['periodFrom']=$from;if($to!==null)$bad['periodTo']=$to;fin_reject(fn()=>fin_normalize($bad),'Invalid period accepted'); }

$month=fin_normalize($monthly+['statisticId'=>'ad-1']);
$wide=$month;$wide['periodFrom']='2026-01-01';
fin_check(fin_overlap($month,$wide),'Overlapping same ad periods rejected');
$distinct=$wide;$distinct['statisticId']='ad-2';
fin_check(!fin_overlap($month,$distinct),'Different ads may cover same period');
$next=$month;$next['periodFrom']='2026-11-01';$next['periodTo']=$next['date']='2026-11-30';
fin_check(!fin_overlap($month,$next),'Nonoverlapping periods allowed');
fin_check(fin_overlap($month,$a) && fin_overlap($a,$month),'Mixed transaction and period rejected both directions');
$inactive=$month;$inactive['active']=false;fin_check(!fin_overlap($inactive,$wide),'Voided expense does not block replacement');
$otherAccount=$wide;$otherAccount['account']='different';fin_check(!fin_overlap($month,$otherAccount),'Separate accounts do not overlap');

$patch=['orderId'=>'261031-001','_id'=>'internal-1','before'=>['closeDate'=>'','companyShare'=>'1200','dispatcher'=>'Сергей','_status'=>'В работе'],'after'=>['closeDate'=>'2026-10-31','companyShare'=>'1250.50','dispatcher'=>'Сергей','_status'=>'Выполнен'],'sourceRow'=>17,'sourceSpreadsheet'=>'sheet-id/October'];
$normalizedPatch=fin_reconciliation_patch($patch);
$order=['orderId'=>'261031-001','_id'=>'internal-1']+$patch['before'];
fin_check(fin_reconciliation_matches($order,$normalizedPatch),'Exact before snapshot matches');
fin_check(!fin_reconciliation_matches(array_replace($order,['companyShare'=>'1201']),$normalizedPatch),'Concurrent cash change rejected');
fin_check(!fin_reconciliation_matches(array_replace($order,['companyShare'=>1200]),$normalizedPatch),'Type-coerced cash rejected');
fin_check(!fin_reconciliation_matches(array_replace($order,['_id'=>'other']),$normalizedPatch),'Different internal identity rejected');
$bad=$patch;$bad['before']['master']='Old';$bad['after']['master']='New';fin_reject(fn()=>fin_reconciliation_patch($bad),'Master reassignment prohibited');
$bad=$patch;$bad['after']['closeDate']='2026-02-31';fin_reject(fn()=>fin_reconciliation_patch($bad),'Invalid closing date rejected');
$bad=$patch;$bad['after']['companyShare']='-1';fin_reject(fn()=>fin_reconciliation_patch($bad),'Negative cash rejected');
$bad=$patch;$bad['after']['_status']='Unknown';fin_reject(fn()=>fin_reconciliation_patch($bad),'Unknown status rejected');
$bad=$patch;unset($bad['before']['dispatcher']);fin_reject(fn()=>fin_reconciliation_patch($bad),'Missing before field rejected');
$missing=$patch;$missing['before']=['closeDate'=>null];$missing['after']=['closeDate'=>'2026-10-31'];$missing=fin_reconciliation_patch($missing);
fin_check(fin_reconciliation_matches(['orderId'=>'261031-001','_id'=>'internal-1'],$missing),'Explicit absent field matches absence');
fin_check(!fin_reconciliation_matches(['orderId'=>'261031-001','_id'=>'internal-1','closeDate'=>null],$missing),'Absent is not persisted null');

$after=['companyShare'=>'1250.50','closeDate'=>'2026-10-31','dispatcher'=>'Сергей','_status'=>'Выполнен'];
$closeProjection=fin_reconciliation_projection(['orderId'=>'261031-001','total'=>'2501','companyShare'=>'1200','closeDate'=>'2026-10-30'],$after,'orderCloseData','stamp');
fin_check($closeProjection['companyShare']==='1250.50'&&$closeProjection['closeDate']==='2026-10-31','Close data no longer overlays stale cash/date');
fin_check($closeProjection['total']==='2501'&&!isset($closeProjection['dispatcher'])&&!isset($closeProjection['_status']),'Close data projection scope preserved');
foreach(['dispatcherOrders','masterAssignments'] as $collection){$projection=fin_reconciliation_projection(['orderId'=>'261031-001'],$after,$collection,'stamp');fin_check(!array_key_exists('companyShare',$projection),'No new financial disclosure in role projections');fin_check($projection['closeDate']==='2026-10-31'&&$projection['_status']==='Выполнен','Role operational fields updated');}

foreach(['masterAmount','total','parts','cleanCheck','pp'] as $field){
    $moneyPatch=$patch;$moneyPatch['before']=[$field=>'100'];$moneyPatch['after']=[$field=>'1250.50'];
    $valid=fin_reconciliation_patch($moneyPatch);
    fin_check(fin_reconciliation_matches(['orderId'=>$patch['orderId'],'_id'=>$patch['_id'],$field=>'100'],$valid),'Money exact before matches: '.$field);
    fin_check(!fin_reconciliation_matches(['orderId'=>$patch['orderId'],'_id'=>$patch['_id'],$field=>'101'],$valid),'Money concurrent change rejected: '.$field);
    foreach(['-1','1.234','1e3','1000000001',true,null] as $invalid){$bad=$moneyPatch;$bad['after'][$field]=$invalid;fin_reject(fn()=>fin_reconciliation_patch($bad),'Invalid money rejected: '.$field);}
}
$financialAfter=['masterAmount'=>'1000','total'=>'2500','parts'=>'500','cleanCheck'=>'2000','pp'=>'0'];
$projected=fin_reconciliation_projection(['orderId'=>'261031-001'],$financialAfter,'orderCloseData','stamp');
fin_check($projected['total']==='2500'&&$projected['parts']==='500','Close projection receives corrected editable financial values');
foreach(['masterAmount','cleanCheck','pp'] as $key)fin_check(!array_key_exists($key,$projected),'Owner-only money remains private: '.$key);
foreach(['dispatcherOrders','masterAssignments'] as $collection){$projected=fin_reconciliation_projection(['orderId'=>'261031-001','_reportLockId'=>'saved-report'],$financialAfter,$collection,'stamp');foreach(array_keys($financialAfter) as $key)fin_check(!array_key_exists($key,$projected),'No new money disclosure: '.$collection.' '.$key);fin_check($projected['_reportLockId']==='saved-report','Saved report lock preserved');}

$clear=$patch;$clear['before']=['companyShare'=>'755'];$clear['after']=['companyShare'=>''];fin_check(fin_reconciliation_patch($clear)['after']['companyShare']==='','Verified empty source preserves absence, not zero');
$link=$patch;$link['before']=['_duplicateOf'=>null];$link['after']=['_duplicateOf'=>'261011-003'];fin_check(fin_reconciliation_patch($link)['after']['_duplicateOf']==='261011-003','Duplicate linkage accepted');$link['after']['_duplicateOf']=$patch['orderId'];fin_reject(fn()=>fin_reconciliation_patch($link),'Self duplicate rejected');
$receipt=$patch;$receipt['before']=['_cashClosedOn'=>null];$receipt['after']=['_cashClosedOn'=>'2026-11-01'];fin_check(fin_reconciliation_patch($receipt)['after']['_cashClosedOn']==='2026-11-01','Verified receipt date accepted');$receipt['after']['_cashClosedOn']='2026-02-31';fin_reject(fn()=>fin_reconciliation_patch($receipt),'Invalid receipt date rejected');

$flag=$patch;$flag['before']=['_autoFinance'=>true];$flag['after']=['_autoFinance'=>false];fin_check(fin_reconciliation_patch($flag)['after']['_autoFinance']===false,'Owner explicit auto-finance disable accepted');
foreach(['false',0,null] as $invalid){$bad=$flag;$bad['after']['_autoFinance']=$invalid;fin_reject(fn()=>fin_reconciliation_patch($bad),'Auto-finance requires boolean');}
$effective=fin_reconciliation_effective_patch(['_autoFinance'=>true],$normalizedPatch);fin_check($effective['before']['_autoFinance']===true&&$effective['after']['_autoFinance']===false,'Source money patch disables auto recalculation and journals both values');
$unchanged=fin_reconciliation_effective_patch(['_autoFinance'=>true],$missing);fin_check(!array_key_exists('_autoFinance',$unchanged['after']),'Date-only patch does not change finance mode');

$baseline=['op'=>'payroll_payments_add','kind'=>'settlement_baseline','baselineConfirmed'=>true,'person'=>'sergey','date'=>'2026-11-01','days'=>[['date'=>'2026-10-31','cashCents'=>2500000],['date'=>'2026-11-01','cashCents'=>1500000]],'reference'=>'baseline-confirmed','note'=>'Owner confirms all settled through November 1','idempotencyKey'=>'baseline-test-confirmed-20261101'];
$bp=fin_payment_plan([],$owner,$baseline,$stamp);fin_check($bp['payment']['amountCents']===450000,'Baseline computed server-side per intake day');
fin_check(!fin_payment_plan([$bp['payment']],$owner,$baseline,$stamp)['changed'],'Baseline retry is idempotent');
$other=$baseline;$other['reference']='different';$other['idempotencyKey']='baseline-test-another-20261101';try{fin_payment_plan([$bp['payment']],$owner,$other,$stamp);throw new RuntimeException('Duplicate baseline accepted');}catch(UnexpectedValueException $e){fin_check($e->getMessage()==='baseline_already_exists','Duplicate baseline rejected');}
$bad=$baseline;$bad['baselineConfirmed']=false;fin_reject(fn()=>fin_payment_normalize($bad),'Confirmation required');
$bad=$baseline;$bad['days'][]=$bad['days'][0];fin_reject(fn()=>fin_payment_normalize($bad),'Duplicate baseline day rejected');
$bad=$baseline;$bad['days'][0]['date']='2026-11-02';fin_reject(fn()=>fin_payment_normalize($bad),'Baseline cannot include future receipts');
echo "settlement baseline tests passed\n";

// Dispatcher closure computes from the server policy, never hidden browser inputs.
$input=['total'=>'10000','parts'=>'2000','review'=>'','master'=>'Николай'];
$empty=['master'=>'Николай'];
$computed=fin_order_plan($empty,$input,[],false);
fin_check($computed['cleanCheck']==='8000.00' && $computed['masterAmount']==='4000.00' && $computed['companyShare']==='4000.00','Dispatcher first close calculates all amounts');
fin_check(fin_order_plan($computed+$empty,$input,[],false)===$computed,'Repeated close is numerically idempotent');
$bonus=fin_order_plan($empty,array_replace($input,['review'=>'да']),[],false);
fin_check($bonus['masterAmount']==='4400.00' && $bonus['companyShare']==='3600.00','Review bonus is included once');
$fixed=fin_order_plan($empty,['total'=>'3000','parts'=>'0','review'=>'','master'=>'Николай'],['fixedRate'=>50],true);
fin_check($fixed['masterAmount']==='1500.00','Private fixed master policy applies');
$policy=fin_order_plan($empty,$input,['gridHigh'=>60],false);
fin_check($policy['masterAmount']==='4800.00','Stored private policy wins over client defaults');
$manual=array_replace($computed,['master'=>'Николай','_autoFinance'=>false,'companyShare'=>'3500','masterAmount'=>'4500']);
fin_check(fin_order_plan($manual,$input,[],false)===[],'Manual source amounts are preserved');
fin_reject(fn()=>fin_order_plan($manual,array_replace($input,['total'=>'11000']),[],false),'Manual total changes require owner');
fin_reject(fn()=>fin_order_plan($manual,array_replace($input,['master'=>'Другой']),[],false),'Manual reassignment requires owner verification');
foreach(['-1','1e4','oops','1.234'] as $value) fin_reject(fn()=>fin_order_plan($empty,array_replace($input,['total'=>$value]),[],false),'Invalid amount rejected');
fin_reject(fn()=>fin_order_plan($empty,array_replace($input,['parts'=>'10001']),[],false),'Parts exceeding total rejected');
$large=fin_order_plan($empty,['total'=>'50000','parts'=>'0','review'=>'да','master'=>'Николай'],[],false);
fin_check($large['masterAmount']==='26000.00','Review bonus is capped at 1000');
echo "dispatcher server finance calculation tests passed\n";

$lockOrder=['callDate'=>'06.11.2026','_status'=>'В работе'];
$lockReport=['date'=>'2026-11-06','orderIds'=>['TEST']];
fin_check(fin_order_report_locked($lockOrder,$lockReport,'TEST'),'Legacy mixed-format report date still locks normal intake order');
fin_check(!fin_order_report_locked($lockOrder,['date'=>'2026-11-05','orderIds'=>['TEST']],'TEST'),'Unrelated report date does not lock intake fallback');
fin_check(fin_order_report_locked($lockOrder,['lockedOrderIds'=>['TEST']],'TEST'),'Explicit lock list is authoritative without a date');
fin_check(fin_order_report_locked($lockOrder,['paidOrderIds'=>['TEST']],'TEST'),'Previously accounted order remains locked');
$pickup=array_replace($lockOrder,['_isPickup'=>true]);
fin_check(!fin_order_report_locked($pickup,$lockReport,'TEST'),'Open pickup in intake list stays editable');
fin_check(fin_order_report_locked($pickup,['paidOrderIds'=>['TEST']],'TEST'),'Paid pickup remains locked');
fin_check(fin_order_report_locked($pickup,['lockedOrderIds'=>['TEST']],'TEST'),'Explicitly locked pickup remains locked');
fin_check(!fin_order_report_locked(['callDate'=>'31.02.2026'],['date'=>'31.02.2026','orderIds'=>['TEST']],'TEST'),'Invalid equal date text is not treated as a valid report match');
echo "dispatcher order report lock tests passed\n";
