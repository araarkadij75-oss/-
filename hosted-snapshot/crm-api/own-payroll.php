<?php
// Read-only, authenticated payroll projection. Never returns other employees or raw ledgers.
declare(strict_types=1);
define('ELITESERVICE_FINANCE_LIBRARY', true);
require_once __DIR__.'/finance.php';
function own_pay_date(mixed $v): string {
 if((is_int($v)||is_float($v))&&$v>1000&&$v<90000)return gmdate('Y-m-d',strtotime('1899-12-30 UTC')+(int)floor($v)*86400);
 if(!is_string($v))return '';
 $isoFormat=false;
 if(preg_match('/^(\d{4})-(\d{2})-(\d{2})$/',trim($v),$m)){[$y,$mo,$d]=[(int)$m[1],(int)$m[2],(int)$m[3]];$isoFormat=true;}
 elseif(preg_match('/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/',trim($v),$m))[$y,$mo,$d]=[(int)$m[3],(int)$m[2],(int)$m[1]];else return '';
 // Match the existing owner parseDate/Date.UTC normalization exactly.
 if($y<100)$y+=$isoFormat?1900:2000;
 return (new DateTimeImmutable('2000-01-01',new DateTimeZone('UTC')))->setDate($y,$mo,$d)->format('Y-m-d');
}
function own_pay_key(string $s): string {
 $s=strtr($s,array_combine(preg_split('//u','АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё',-1,PREG_SPLIT_NO_EMPTY),preg_split('//u','абвгдеежзийклмнопрстуфхцчшщъыьэюяе',-1,PREG_SPLIT_NO_EMPTY)));
 return strtolower(trim(preg_replace('/\s+/u',' ',$s)??$s));
}
function own_pay_person(array $r): string {
 $raw=own_pay_key((string)(($r['shift']??'')?:($r['id']??'')?:($r['approvedFor']??'')));
 $name=own_pay_key((string)(($r['approvedForName']??'')?:($r['shiftName']??'')?:($r['closedByName']??'')));
 if((in_array($raw,['artem','2'],true)||preg_match('/^\d{4}-\d{2}-\d{2}-artem$/',$raw))||in_array($name,['артем','смена артема'],true))return 'artem';
 if((in_array($raw,['sergey','1'],true)||preg_match('/^\d{4}-\d{2}-\d{2}-sergey$/',$raw))||in_array($name,['сергей','смена сергея'],true))return 'sergey';return '';
}
function own_pay_order_person(array $r,array $members): string {
 $name=own_pay_key((string)($r['dispatcher']??''));
 if($name!==''){
  $direct=own_pay_person(['approvedForName'=>$name]);if($direct!=='')return $direct;
  foreach($members as $m)if(in_array($m['role']??'',['dispatcher','dispatcher_logistic','logistic'],true)&&in_array($name,[own_pay_key((string)($m['name']??'')),own_pay_key((string)($m['login']??''))],true))return own_pay_person(['shift'=>$m['shift']??'','approvedForName'=>$m['name']??'']);return '';
 }
 $name=own_pay_key((string)($r['_createdByName']??''));$direct=own_pay_person(['approvedForName'=>$name]);if($direct!=='')return $direct;
 foreach($members as $m)if(in_array($m['role']??'',['dispatcher','dispatcher_logistic','logistic'],true)&&((!empty($r['_createdBy'])&&($m['id']??'')===$r['_createdBy'])||($name!==''&&own_pay_key((string)($m['name']??''))===$name)))return own_pay_person(['approvedForName'=>$m['name']??''])?:own_pay_person(['shift'=>$m['shift']??'']);
 return own_pay_person(['shift'=>$r['_createdByShift']??'']);
}
function own_pay_cash_date(array $r): string {
 $date=own_pay_date($r['closeDate']??'');if($date!=='')return $date;
 if(preg_match('/^(\d{1,2})[.\/-](\d{1,2})$/',trim((string)($r['closeDate']??'')),$m)){
  $base=own_pay_date($r['visitDate']??'')?:own_pay_date($r['callDate']??'')?:own_pay_date(substr((string)($r['_createdAt']??''),0,10));
  if($base!==''&&checkdate((int)$m[2],(int)$m[1],(int)substr($base,0,4)))return sprintf('%s-%02d-%02d',substr($base,0,4),(int)$m[2],(int)$m[1]);
 }
 return own_pay_date($r['_cashClosedOn']??'')?:own_pay_date(substr((string)($r['_cashClosedAt']??''),0,10));
}
function own_pay_money(mixed $v): int {
 if($v===null||$v==='')return 0;
 $s=trim((string)$v);$negative=preg_match('/^\(.*\)$/',$s);$s=preg_replace('/[^0-9,.-]/u','',$s)??'';
 $comma=strrpos($s,',');$dot=strrpos($s,'.');
 if($comma!==false&&$dot!==false)$s=$comma>$dot?str_replace(',','.',str_replace('.','',$s)):str_replace(',','',$s);elseif($comma!==false)$s=str_replace(',','.',$s);
 if(!is_numeric($s))return 0;$number=(float)$s;if($negative)$number=-abs($number);
 if($number<0||!is_finite($number)||$number>90071992547409)throw new InvalidArgumentException('invalid_order_amount');return (int)floor($number*100+0.5);
}
function own_pay_master_equivalent(string $a,string $b): bool {
 $a=str_replace('.','',own_pay_key($a));$b=str_replace('.','',own_pay_key($b));if($a===''||$b==='')return false;if($a===$b)return true;
 $left=explode(' ',$a);$right=explode(' ',$b);if(count($left)<2||count($left)!==count($right))return false;
 $single=static fn($v)=>preg_match('/^.$/u',$v)===1;
 $match=function(int $i,array $used,bool $exact)use(&$match,$left,$right,$single):bool{if($i===count($left))return $exact;foreach($right as $j=>$b){if(isset($used[$j]))continue;$a=$left[$i];$same=$a===$b;$initial=($single($a)&&str_starts_with($b,$a))||($single($b)&&str_starts_with($a,$b));if(!$same&&!$initial)continue;$next=$used;$next[$j]=true;if($match($i+1,$next,$exact||($same&&!$single($a))))return true;}return false;};
 return $match(0,[],false);
}
function own_pay_master_match(string $order,string $profile,array $known): bool {
 if(str_replace('.','',own_pay_key($order))===str_replace('.','',own_pay_key($profile)))return $profile!=='';
 if(!own_pay_master_equivalent($order,$profile))return false;
 $matches=[];foreach($known as $name){$key=str_replace('.','',own_pay_key($name));$tokens=explode(' ',$key);if(count($tokens)<2||array_filter($tokens,static fn($v)=>preg_match('/^.$/u',$v)===1))continue;if(own_pay_master_equivalent($order,$name))$matches[$key]=$name;}
 return count($matches)===1&&own_pay_master_equivalent((string)reset($matches),$profile);
}
function own_pay_projection(array $actor,array $orders,array $reports,array $ledger,array $members,string $cutoff,string $anchor='2026-09-15',string $first='artem'): array {
 $role=$actor['role']??'';
 if(empty($actor['uid'])||!in_array($role,['dispatcher_logistic','logistic','master'],true))throw new DomainException('staff_required');
 if(own_pay_date($cutoff)!==$cutoff||own_pay_date($anchor)!==$anchor||!in_array($first,['artem','sergey'],true))throw new DomainException('payroll_schedule_invalid');
 $person=own_pay_person(['shift'=>$actor['shift']??'','approvedForName'=>$actor['name']??'']);
 $named=own_pay_person(['approvedForName'=>$actor['name']??'']);$shifted=own_pay_person(['shift'=>$actor['shift']??'']);
 if($role!=='master'&&$named!==''&&$shifted!==''&&$named!==$shifted)throw new DomainException('payroll_identity_conflict');
 if($role!=='master'&&$person==='')throw new DomainException('payroll_identity_unresolved');
 $days=[];$seen=[];$warnings=[];$knownMasters=[];
 if($role==='master'){foreach($members as $m)if(($m['role']??'')==='master'&&($m['active']??true)!==false)$knownMasters[]=(string)(($m['master']??'')?:($m['name']??''));foreach($orders as $o)$knownMasters[]=(string)($o['master']??'');$knownMasters[]=(string)(($actor['master']??'')?:($actor['name']??''));}
 foreach($orders as $r){
  $id=(string)($r['orderId']??'');if($id===''||isset($seen[$id])||!empty($r['_duplicateOf']))continue;$seen[$id]=true;
  if($role==='master'){
   $master=(string)(($actor['master']??'')?:($actor['name']??''));
   if($master===''||!own_pay_master_match((string)($r['master']??''),$master,$knownMasters))continue;
  }elseif(own_pay_order_person($r,$members)!==$person)continue;
  $date=own_pay_date($r['callDate']??'');if($date===''||$date<$anchor||$date>$cutoff)continue;
  if(!isset($days[$date]))$days[$date]=['date'=>$date,'cashCents'=>0,'earnedCents'=>$role==='master'?0:200000,'orderIds'=>[]];
  $closed=!empty($r['_cashClosedAt'])||!empty($r['_cashClosedOn'])||($r['_status']??'')==='Выполнен';if(!$closed)continue;
  $cashDate=own_pay_cash_date($r);if($cashDate!==''&&($cashDate<$date||$cashDate>$cutoff)){if($cashDate<$date)$warnings['cash_before_intake']=true;continue;}
  try{$cash=own_pay_money($r[$role==='master'?'masterAmount':'companyShare']??0);}catch(InvalidArgumentException $e){$warnings['invalid_amount']=true;continue;}
  if($cash===0)continue;if($cashDate==='')$warnings['missing_cash_date']=true;
  $days[$date]['cashCents']+=$cash;$days[$date]['orderIds'][]=$id;
 }
 if($role==='master'){
  foreach($days as &$d){$d['earnedCents']=$d['cashCents'];unset($d['cashCents']);}unset($d);ksort($days);
  return ['ok'=>true,'kind'=>'master','cutoff'=>$cutoff,'earnedCents'=>array_sum(array_column($days,'earnedCents')),'paidCents'=>null,'dueCents'=>null,'days'=>array_values($days),'cycles'=>[],'warnings'=>array_keys($warnings)];
 }
 $paidReports=[];$latestReports=[];
 usort($reports,static fn($a,$b)=>strcmp((string)($a['closedAt']??''),(string)($b['closedAt']??'')));
 foreach($reports as $r){$key=($r['date']??'').'-'.own_pay_person($r);$previous=$latestReports[$key]??null;$priority=static fn($x)=>empty($x['closureOnly'])&&empty($x['draft'])&&(!empty($x['ownerConfirmed'])||!empty($x['dataHash']));if($previous!==null&&$priority($previous)&&!$priority($r))continue;$latestReports[$key]=$r;}
 foreach($latestReports as $r){
  if(own_pay_person($r)!==$person||!empty($r['closureOnly'])||!empty($r['draft'])||!empty($r['voided'])||!((!empty($r['ownerConfirmed'])&&!empty($r['subjectMemberId']))||(!empty($r['dataHash'])&&!empty($r['closedBy']))))continue;
  $date=own_pay_date($r['date']??'');if($date===''||$date<$anchor||$date>$cutoff)continue;
  $days[$date]??=['date'=>$date,'cashCents'=>0,'earnedCents'=>200000,'orderIds'=>[]];
  if(!empty($r['ownerConfirmed'])&&!empty($r['subjectMemberId'])&&!empty($r['closedAt'])&&$r['closedAt']<='2026-11-02T10:59:27.607Z')$paidReports[$r['id']??$date]=['date'=>$date,'amountCents'=>own_pay_money($r['salary']??0)];
 }
 $baseline=null;$payments=[];
 foreach($ledger as $p){if(($p['person']??'')!==$person||($p['active']??true)===false||($p['date']??'')>$cutoff)continue;if(($p['kind']??'')==='settlement_baseline'&&($baseline===null||$baseline['date']<$p['date']))$baseline=$p;}
 foreach($paidReports as $p)if($baseline===null||$p['date']>$baseline['date'])$payments[]=$p;
 foreach($ledger as $p)if(($p['person']??'')===$person&&($p['active']??true)!==false&&($p['kind']??'')!=='settlement_baseline'&&($p['date']??'')<=$cutoff&&($baseline===null||$p['date']>$baseline['date']))$payments[]=['date'=>$p['date'],'amountCents'=>$p['amountCents']];
 if($baseline!==null)$payments[]=['date'=>$baseline['date'],'amountCents'=>$baseline['amountCents']];
 $cycles=[];ksort($days);
 foreach($days as &$d){
  $d['earnedCents']=max(200000,(int)round($d['cashCents']/10));
  $delta=(int)((strtotime($d['date'].' UTC')-strtotime($anchor.' UTC'))/86400);$scheduled=($delta%4)<2?$first:($first==='artem'?'sergey':'artem');$cycleStart=$d['date'];$end=$d['date'];if($scheduled===$person){$cycleStart=gmdate('Y-m-d',strtotime($anchor.' UTC')+(intdiv($delta,2)*2)*86400);$end=gmdate('Y-m-d',strtotime($cycleStart.' UTC')+86400);}
  $cycles[$cycleStart]??=['start'=>$cycleStart,'end'=>$end,'earnedCents'=>0,'days'=>[]];$cycles[$cycleStart]['earnedCents']+=$d['earnedCents'];$cycles[$cycleStart]['days'][]=$d['date'];
 }unset($d);
 $earned=array_sum(array_column($days,'earnedCents'));$paid=array_sum(array_column($payments,'amountCents'));
 foreach($days as &$d)unset($d['cashCents']);unset($d);
 return ['ok'=>true,'kind'=>'dispatcher','cutoff'=>$cutoff,'earnedCents'=>$earned,'paidCents'=>$paid,'dueCents'=>max(0,$earned-$paid),'overpaidCents'=>max(0,$paid-$earned),'days'=>array_values($days),'cycles'=>array_values($cycles),'warnings'=>array_keys($warnings)];
}
function own_pay_read(PDO $pdo,string $collection): array {
 $q=$pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? ORDER BY document_id LIMIT 20001');$q->execute([tg_workspace(),'workspaces/'.tg_workspace().'/'.$collection]);$rows=$q->fetchAll();if(count($rows)>20000)throw new LengthException('payroll_capacity');$result=[];
 foreach($rows as $row){$r=json_decode((string)$row['data_json'],true);if(!is_array($r))throw new RuntimeException('invalid_payroll_document');$result[]=array_replace(['id'=>$row['document_id']],$r);}return $result;
}
if(defined('ELITESERVICE_OWN_PAYROLL_LIBRARY'))return;
try{
 if(($_SERVER['REQUEST_METHOD']??'')!=='POST')tg_reply(405,['ok'=>false,'error'=>'method']);
 $pdo=tg_db();$actor=tg_jwt_actor($pdo);
 if(!in_array($actor['role']??'',['dispatcher_logistic','logistic','master'],true))throw new DomainException('staff_required');
 $pdo->beginTransaction();
 $public=tg_read($pdo,tg_path('config','public'))??[];
 $projection=own_pay_projection($actor,own_pay_read($pdo,'orders'),own_pay_read($pdo,'shiftReports'),own_pay_read($pdo,'payrollPayments'),own_pay_read($pdo,'members'),(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d'),$public['payrollCycleAnchor']??'2026-09-15',$public['payrollCycleStart']??'artem');
 $pdo->commit();tg_reply(200,$projection);
}catch(DomainException $e){if(isset($pdo)&&$pdo->inTransaction())$pdo->rollBack();tg_reply(403,['ok'=>false,'error'=>$e->getMessage()]);}catch(Throwable $e){if(isset($pdo)&&$pdo->inTransaction())$pdo->rollBack();tg_reply(503,['ok'=>false,'error'=>'payroll_service_unavailable']);}
