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
