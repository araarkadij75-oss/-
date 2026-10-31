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
