<?php
declare(strict_types=1);
define('ELITESERVICE_OWN_PAYROLL_LIBRARY',true);
require __DIR__.'/../hosted-snapshot/crm-api/own-payroll.php';
function own_check(bool $v,string $label): void{if(!$v)throw new RuntimeException($label);}
function own_order(string $id,string $person,string $day,string $cashDate,int $cash): array{return ['orderId'=>$id,'dispatcher'=>$person==='sergey'?'Сергей':'Артём','callDate'=>$day,'closeDate'=>$cashDate,'companyShare'=>(string)$cash,'_status'=>'Выполнен','master'=>'Николай','masterAmount'=>'500'];}
$actor=['uid'=>'sergey-uid','name'=>'Сергей','shift'=>'sergey','role'=>'dispatcher_logistic'];
$orders=[own_order('mine','sergey','2026-10-04','2026-10-04',15000),own_order('late','sergey','2026-10-04','2026-11-05',10000),own_order('today','sergey','2026-11-06','2026-11-06',15000),own_order('foreign','artem','2026-11-06','2026-11-06',990000)];
$ledger=[['id'=>'baseline','person'=>'sergey','kind'=>'settlement_baseline','date'=>'2026-11-01','amountCents'=>200000,'active'=>true],['id'=>'paid-late','person'=>'sergey','date'=>'2026-11-05','amountCents'=>50000,'active'=>true],['id'=>'voided','person'=>'sergey','date'=>'2026-11-06','amountCents'=>900000,'active'=>false],['id'=>'foreign','person'=>'artem','date'=>'2026-11-06','amountCents'=>9999999,'active'=>true],['id'=>'old-in-baseline','person'=>'sergey','date'=>'2026-10-04','amountCents'=>200000,'active'=>true]];
$r=own_pay_projection($actor,$orders,[],$ledger,[],'2026-11-06');
own_check($r['earnedCents']===450000&&$r['paidCents']===250000&&$r['dueCents']===200000,'Late 500, daily minimum and paid baseline settle exactly once');
own_check(!str_contains(json_encode($r),'foreign')&&!str_contains(json_encode($r),'990000')&&!isset($r['days'][0]['cashCents']),'Foreign payroll and raw cash absent');
own_check(count($r['cycles'])===2,'Two-day intake cycles');
$orders[]=array_replace($orders[0],['orderId'=>'duplicate','_duplicateOf'=>'mine']);$orders[]=$orders[0];
$r2=own_pay_projection($actor,$orders,[],$ledger,[],'2026-11-06');own_check($r2['earnedCents']===$r['earnedCents'],'Duplicate records excluded');
$orders[0]['closeDate']='';$r3=own_pay_projection($actor,$orders,[],$ledger,[],'2026-11-06');own_check($r3['earnedCents']===450000&&in_array('missing_cash_date',$r3['warnings'],true),'Undated confirmed receipt retained without invented date');
$master=own_pay_projection(['uid'=>'master-uid','role'=>'master','master'=>'Николай'],[$orders[0],array_replace($orders[1],['master'=>'Другой'])],[],[],[],'2026-11-06');own_check($master['earnedCents']===50000&&$master['dueCents']===null&&count($master['days'][0]['orderIds'])===1,'Master sees only own assignment earnings; no invented dispatcher minimum or payments');
$reports=[['id'=>'old','date'=>'2026-10-04','shift'=>'sergey','ownerConfirmed'=>true,'subjectMemberId'=>'sergey-uid','closedAt'=>'2026-10-04T18:00:00Z','salary'=>'1000'],['id'=>'new','date'=>'2026-10-04','shift'=>'sergey','ownerConfirmed'=>true,'subjectMemberId'=>'sergey-uid','closedAt'=>'2026-10-05T18:00:00Z','salary'=>'2000']];
$replayed=own_pay_projection($actor,[],$reports,[],[],'2026-11-06');own_check($replayed['paidCents']===200000&&$replayed['dueCents']===0,'Legacy reports deduplicated by employee and date');
foreach([['uid'=>'owner','role'=>'owner'],['uid'=>'bad','role'=>'dispatcher_logistic','name'=>'Неизвестный'],['role'=>'master','master'=>'Николай']] as $bad){try{own_pay_projection($bad,$orders,[],$ledger,[],'2026-11-06');throw new RuntimeException('Unauthorized actor accepted');}catch(DomainException $e){}}
echo "own payroll isolation, late receipt, baseline, payment and master policy tests passed\n";

$fixture=json_decode(file_get_contents(__DIR__.'/fixtures/own-payroll-live-sanitized.json'),true,512,JSON_THROW_ON_ERROR);
foreach($fixture['expected'] as $expected){
 $actor=['uid'=>'fixture-'.$expected['person'],'name'=>$expected['person']==='sergey'?'Сергей':'Артём','shift'=>$expected['person'],'role'=>'dispatcher_logistic'];
 $result=own_pay_projection($actor,$fixture['orders'],$fixture['reports'],$fixture['ledger'],$fixture['members'],$fixture['cutoff'],$fixture['anchor'],$fixture['first']);
 foreach(['earnedCents','paidCents','dueCents','overpaidCents'] as $key)own_check($result[$key]===$expected[$key],$expected['person'].' live parity '.$key.': '.$result[$key].' !== '.$expected[$key]);
 $expectedDays=array_values(array_filter($fixture['expectedDays'],static fn($d)=>$d['person']===$expected['person']));
 own_check(count($result['days'])===count($expectedDays),'Live day count');
 foreach($expectedDays as $i=>$day){$actual=$result['days'][$i];sort($actual['orderIds']);own_check($actual['date']===$day['date']&&$actual['earnedCents']===$day['earnedCents']&&$actual['orderIds']===$day['orderIds'],'Live daily and order attribution parity '.$day['date']);}
}
own_check(own_pay_date(46332)==='2026-11-06','Excel serial date support');
own_check(own_pay_date('6-11-26')==='2026-11-06','Source two digit year support');
own_check(own_pay_cash_date(['closeDate'=>'6.11','callDate'=>'2026-11-01'])==='2026-11-06','Source surrender date inherits year');
own_check(own_pay_cash_date(['_cashClosedAt'=>'2026-11-06T20:15:00Z'])==='2026-11-06','Cash timestamp only takes date');
own_check(own_pay_money('1 234,50 ₽')===123450&&own_pay_money('1,234.50')===123450,'Source currency normalization');
echo "live sanitized owner/staff parity: Sergey 0, Artem 12108.50; all daily earned and order IDs match\n";
try{own_pay_projection(['uid'=>'conflict','role'=>'dispatcher_logistic','name'=>'Сергей','shift'=>'artem'],$orders,[],$ledger,[],'2026-11-06');throw new RuntimeException('Conflicting actor identity accepted');}catch(DomainException $e){own_check($e->getMessage()==='payroll_identity_conflict','Conflicting identity fails closed');}
own_check(own_pay_master_match('Костромин Н.','Костромин Николай',['Костромин Николай']),'Unique initials resolve own master');
own_check(!own_pay_master_match('Костромин Н.','Костромин Николай',['Костромин Николай','Костромин Никита']),'Ambiguous initials do not reveal another master earnings');
