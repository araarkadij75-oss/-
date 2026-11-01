<?php
declare(strict_types=1);
define('ELITESERVICE_BRIDGE_LIBRARY', true);
require_once __DIR__ . '/telegram.php';

// Cron: php /absolute/site/crm-api/quality.php --document-root=/absolute/site
// The endpoint only reads cron results; HTTP requests never start scans.
function quality_owner(array $actor): void {
    if (($actor['role'] ?? '') !== 'owner' || empty($actor['uid'])) throw new DomainException('owner_required');
}
function quality_private_dir(): string {
    $root = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    if (!$root) throw new RuntimeException('private_storage_unavailable');
    $configured = getenv('ELITESERVICE_CONFIG');
    $candidate = $configured ? dirname($configured) : $root;
    for ($i = 0; $i < 8; $i++) {
        if (is_file($candidate . '/eliteservice-config.php') && is_file($candidate . '/eliteservice-runtime.php')) {
            $dir = realpath($candidate);
            if (!$dir || $dir === $root || str_starts_with($dir, $root . DIRECTORY_SEPARATOR)) throw new RuntimeException('private_storage_unavailable');
            return $dir;
        }
        if ($configured || $candidate === dirname($candidate)) break;
        $candidate = dirname($candidate);
    }
    throw new RuntimeException('private_storage_unavailable');
}
function quality_number(mixed $v): ?float {
    if ($v === null || trim((string)$v) === '') return null;
    $s = str_replace([',', ' ', "\xc2\xa0", '₽'], ['.', '', '', ''], (string)$v);
    return is_numeric($s) && is_finite((float)$s) ? (float)$s : null;
}
function quality_date(mixed $v, ?int $year = null): string {
    $s = trim((string)$v);
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/', $s, $m)) { $y=(int)$m[1]; $mo=(int)$m[2]; $d=(int)$m[3]; }
    elseif (preg_match('/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/', $s, $m)) { $d=(int)$m[1]; $mo=(int)$m[2]; $y=isset($m[3])?(int)$m[3]:($year??0); if(isset($m[3])&&$y<100)$y+=2000; }
    else return '';
    return $y >= 1900 && $y <= 2200 && checkdate($mo,$d,$y) ? sprintf('%04d-%02d-%02d',$y,$mo,$d) : '';
}
function quality_who(array $r): string {
    $value = trim((string)($r['shift'] ?? ''));
    if (in_array($value,['sergey','artem'],true)) return $value;
    $value = trim((string)($r['approvedForName'] ?? $r['shiftName'] ?? $r['dispatcher'] ?? ''));
    return match($value) {'Сергей','сергей','СЕРГЕЙ','Смена Сергея'=>'sergey','Артём','Артем','артём','артем','АРТЁМ','АРТЕМ','Смена Артёма','Смена Артема'=>'artem',default=>$value};
}
function quality_analyze(array $orders, array $reports): array {
    $issues=[]; $counts=[]; $byId=[];
    $add=static function(string $code,string $id,string $severity='warning',string $reportId='') use (&$issues,&$counts): void {
        $counts[$code]=($counts[$code]??0)+1;
        if(count($issues)<500)$issues[]=['code'=>$code,'orderId'=>$id,'severity'=>$severity,'reportId'=>$reportId];
    };
    foreach($orders as $r){
        $id=trim((string)($r['orderId']??$r['_id']??''));
        if(isset($byId[$id]))$add('duplicate_order',$id,'error');else $byId[$id]=$r;
        $status=trim((string)($r['_status']??'')); $closed=in_array($status,['Выполнен','Закрыт','Закрыто'],true);
        if($status!==''&&!$closed&&!in_array($status,['Отказ','Отмена'],true)){
            foreach(['name','phone','request','visitDate'] as $field)if(trim((string)($r[$field]??''))===''){$add('active_required',$id);break;}
            if(trim((string)($r['master']??''))==='')$add('active_master',$id);
        }
        $base=quality_date($r['callDate']??'')?:quality_date($r['visitDate']??'');$year=$base!==''?(int)substr($base,0,4):null;
        foreach(['callDate','visitDate','closeDate'] as $field)if(trim((string)($r[$field]??''))!==''&&!quality_date($r[$field],$field==='closeDate'?$year:null))$add('invalid_'.$field,$id,'error');
        if($closed){
            // A technical creator UID (including the owner/importer) is not proof
            // of which dispatcher accepted the order.
            $creatorWho=quality_who(['dispatcher'=>$r['_createdByName']??'']);
            if(trim((string)($r['dispatcher']??''))===''&&!in_array($creatorWho,['sergey','artem'],true))$add('closed_dispatcher',$id,'error');
            if(!quality_date($r['closeDate']??'',$year)&&!quality_date($r['_cashClosedOn']??'')&&!quality_date($r['_cashClosedAt']??''))$add('closed_date',$id,'error');
            if(trim((string)($r['companyShare']??''))==='')$add('closed_cash',$id);
        }
        $n=[];foreach(['total','parts','masterAmount','companyShare'] as $field){$n[$field]=quality_number($r[$field]??null);if(trim((string)($r[$field]??''))!==''&&$n[$field]===null)$add('invalid_'.$field,$id,'error');}
        if($n['total']!==null&&$n['masterAmount']!==null&&$n['companyShare']!==null&&($n['parts']!==null||trim((string)($r['parts']??''))==='')&&abs($n['masterAmount']+$n['companyShare']-($n['total']-($n['parts']??0)))>1)$add('finance_mismatch',$id,'error');
    }
    usort($reports,static fn($a,$b)=>strcmp((string)($a['closedAt']??''),(string)($b['closedAt']??'')));$unique=[];
    $priority=static fn($r)=>empty($r['closureOnly'])&&empty($r['draft'])&&(!empty($r['ownerConfirmed'])||!empty($r['dataHash']))?1:0;
    foreach($reports as $r){$key=($r['date']??'').'|'.quality_who($r);if(!isset($unique[$key])||$priority($r)>=$priority($unique[$key]))$unique[$key]=$r;}
    $paid=[];foreach($unique as $r){if(!empty($r['closureOnly'])||!empty($r['draft'])||!empty($r['voided'])||!((!empty($r['ownerConfirmed'])&&!empty($r['subjectMemberId']))||(!empty($r['dataHash'])&&!empty($r['closedBy']))))continue;
        $ids=is_array($r['paidOrderIds']??null)?$r['paidOrderIds']:(is_array($r['orderIds']??null)?$r['orderIds']:[]);
        foreach($ids as $raw){$id=(string)$raw;$reportId=(string)($r['id']??'');if(isset($paid[$id]))$add('paid_duplicate',$id,'error',$reportId);else $paid[$id]=$reportId;
            if(!isset($byId[$id]))$add('paid_order_missing',$id,'warning',$reportId);else{$owner=quality_who(['dispatcher'=>$byId[$id]['dispatcher']??'']);if($owner!==''&&quality_who($r)!==''&&$owner!==quality_who($r))$add('paid_owner_conflict',$id,'warning',$reportId);}
        }
    }
    return ['orderCount'=>count($orders),'reportCount'=>count($reports),'issueCount'=>array_sum($counts),'counts'=>$counts,'issues'=>$issues,'issuesTruncated'=>array_sum($counts)>count($issues)];
}
function quality_load(PDO $pdo,string $collection,int $limit): array {
    if(!in_array($collection,['orders','shiftReports'],true))throw new InvalidArgumentException('collection');
    $q=$pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? ORDER BY document_id LIMIT '.($limit+1));
    $q->execute([tg_workspace(),'workspaces/'.tg_workspace().'/'.$collection]);$rows=$q->fetchAll();if(count($rows)>$limit)throw new LengthException('scan_capacity');$out=[];
    foreach($rows as $row){$data=json_decode((string)$row['data_json'],true,64,JSON_THROW_ON_ERROR);if(!is_array($data))throw new RuntimeException('invalid_document');$data[$collection==='orders'?'orderId':'id']??=(string)$row['document_id'];$out[]=$data;}return $out;
}
function quality_save(string $file,array $value): void {
    $temp=tempnam(dirname($file),'.quality-');if($temp===false)throw new RuntimeException('storage');
    try{if(!chmod($temp,0600)||file_put_contents($temp,json_encode($value,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),LOCK_EX)===false||!rename($temp,$file))throw new RuntimeException('storage');}finally{if(is_file($temp))unlink($temp);}
}
function quality_read(string $file): array {
    if(!is_file($file))return ['state'=>'not_started','lastSuccessAt'=>null];
    if(filesize($file)>2000000)throw new RuntimeException('storage');$value=json_decode((string)file_get_contents($file),true,64,JSON_THROW_ON_ERROR);if(!is_array($value))throw new RuntimeException('storage');return $value;
}
function quality_run(string $dir): array {
    $lock=fopen($dir.'/eliteservice-quality.lock','c');if($lock===false)throw new RuntimeException('storage');chmod($dir.'/eliteservice-quality.lock',0600);
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);return ['state'=>'already_running'];}
    $file=$dir.'/eliteservice-quality.json';$previous=[];
    try{$previous=quality_read($file);$started=gmdate('c');quality_save($file,$previous+['lastSuccessAt'=>null]);
        quality_save($file,array_merge($previous,['state'=>'running','startedAt'=>$started,'heartbeatAt'=>$started]));
        $pdo=tg_db();$pdo->beginTransaction();try{$orders=quality_load($pdo,'orders',20000);$reports=quality_load($pdo,'shiftReports',10000);$pdo->commit();}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        $result=quality_analyze($orders,$reports);$stamp=gmdate('c');$record=['state'=>'ok','startedAt'=>$started,'heartbeatAt'=>$stamp,'lastSuccessAt'=>$stamp,'result'=>$result];quality_save($file,$record);return ['state'=>'ok','orderCount'=>$result['orderCount'],'issueCount'=>$result['issueCount']];
    }catch(Throwable $e){quality_save($file,array_merge($previous,['state'=>'error','heartbeatAt'=>gmdate('c'),'error'=>'quality_scan_failed']));return ['state'=>'error','error'=>'quality_scan_failed'];}
    finally{flock($lock,LOCK_UN);fclose($lock);}
}
if(defined('ELITESERVICE_QUALITY_LIBRARY')&&ELITESERVICE_QUALITY_LIBRARY)return;
if(PHP_SAPI==='cli'){
    try{$args=getopt('',['document-root:']);$root=realpath((string)($args['document-root']??''));if(!$root)throw new InvalidArgumentException('document_root_required');$_SERVER['DOCUMENT_ROOT']=$root;@set_time_limit(120);$out=quality_run(quality_private_dir());echo json_encode($out,JSON_THROW_ON_ERROR).PHP_EOL;exit(($out['state']??'')==='error'?1:0);}catch(Throwable $e){fwrite(STDERR,"quality_monitor_unavailable\n");exit(1);}
}
try{
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST')tg_reply(405,['ok'=>false,'error'=>'method']);
    $body=json_decode((string)file_get_contents('php://input',false,null,0,4097),true);if(!is_array($body)||($body['op']??'')!=='status')tg_reply(400,['ok'=>false,'error'=>'invalid_operation']);
    $pdo=tg_db();quality_owner(tg_jwt_actor($pdo));$status=quality_read(quality_private_dir().'/eliteservice-quality.json');$stamp=strtotime((string)($status['lastSuccessAt']??''));$status['stale']=!$stamp||time()-$stamp>900;tg_reply(200,['ok'=>true,'monitor'=>$status]);
}catch(DomainException $e){tg_reply(403,['ok'=>false,'error'=>'owner_required']);}catch(Throwable $e){tg_reply(503,['ok'=>false,'error'=>'quality_service_unavailable']);}
