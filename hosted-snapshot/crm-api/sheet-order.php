<?php
declare(strict_types=1);
define('ELITESERVICE_FINANCE_LIBRARY', true);
require_once __DIR__.'/finance.php';
require_once __DIR__.'/sheet-order-map.php';

const ORDER_BOOK = '1A2qaFu8zHMwl2D-uvkGdhuX2UYUE9s4Gp1ItG4WA4Ug';
const ORDER_TAB = 'Лист1';
const ORDER_META_KEY = 'eliteservice_order_id';

const ORDER_WRITER = 'crm-sheet-writer@master-ai-beta-9440599.iam.gserviceaccount.com';

// Resolve the parent even when the key has not yet been created. Never follow
// symlinks at the key location or create it in a public directory.
function sheet_key_path(): string {
    $docroot=(string)($_SERVER['DOCUMENT_ROOT']??'');
    $root=$docroot!==''?realpath($docroot):false;
    if (!$root) throw new RuntimeException('sheet_not_configured');
    $path=getenv('ELITESERVICE_SHEETS_CREDENTIALS');
    if (!$path) {
        $private=getenv('ELITESERVICE_CONFIG');
        if ($private && is_file($private)) $path=dirname($private).'/eliteservice-sheets.json';
        else {
            for ($dir=$root,$i=0;$i<8 && dirname($dir)!==$dir;$i++,$dir=dirname($dir)) {
                if (is_file($dir.'/eliteservice-config.php')) { $path=$dir.'/eliteservice-sheets.json'; break; }
            }
        }
    }
    $dir=$path?realpath(dirname($path)):false;
    if (!$dir || $dir===$root || str_starts_with($dir,$root.DIRECTORY_SEPARATOR) || is_link($path)) throw new RuntimeException('sheet_not_configured');
    return $dir.DIRECTORY_SEPARATOR.basename($path);
}

function sheet_generate_private_key(string $path):void {
    if (is_file($path)) return;
    $options=['private_key_bits'=>2048,'private_key_type'=>OPENSSL_KEYTYPE_RSA,'digest_alg'=>'sha256'];
    $key=openssl_pkey_new($options);
    if (!$key || !openssl_pkey_export($key,$private,null,$options)) throw new RuntimeException('sheet_not_configured');
    $csr=openssl_csr_new(['commonName'=>'EliteService CRM Sheets writer','emailAddress'=>ORDER_WRITER],$key,$options);
    $cert=$csr?openssl_csr_sign($csr,null,$key,365,$options,random_int(1,2147483647)):false;
    if (!$cert || !openssl_x509_export($cert,$public)) throw new RuntimeException('sheet_not_configured');
    $json=json_encode(['type'=>'service_account','client_email'=>ORDER_WRITER,'private_key'=>$private,'public_certificate'=>$public],JSON_THROW_ON_ERROR);
    $temp=dirname($path).DIRECTORY_SEPARATOR.'.sheets-'.bin2hex(random_bytes(16)).'.tmp';
    $mask=umask(0077);
    try {
        $fp=fopen($temp,'xb');
        if (!$fp) throw new RuntimeException('sheet_not_configured');
        try {
            if (!chmod($temp,0600) || fwrite($fp,$json)!==strlen($json) || !fflush($fp)) throw new RuntimeException('sheet_not_configured');
        } finally { fclose($fp); }
        // A concurrent owner request may have installed another complete key.
        // Atomic no-clobber publication keeps the first certificate authoritative.
        if (!@link($temp,$path) && !is_file($path)) throw new RuntimeException('sheet_not_configured');
    } finally {
        if (is_file($temp)) unlink($temp);
        umask($mask);
    }
}

function sheet_credentials(bool $provision=false):array {
    $path=sheet_key_path();
    if ($provision && !is_file($path)) sheet_generate_private_key($path);
    if (!is_file($path) || !is_readable($path)) throw new RuntimeException('sheet_not_configured');
    $cfg=json_decode((string)file_get_contents($path),true);
    if (($cfg['type']??'')!=='service_account' || empty($cfg['client_email']) || empty($cfg['private_key'])) throw new RuntimeException('sheet_not_configured');
    return $cfg;
}
function sheet_public_certificate():string {
    $cfg=sheet_credentials();
    $pem=$cfg['public_certificate']??'';
    if (!is_string($pem) || !str_starts_with($pem,'-----BEGIN CERTIFICATE-----') || !openssl_x509_export($pem,$canonical)) throw new RuntimeException('sheet_not_configured');
    return $canonical;
}
function sheet_http(string $url, ?string $body, array $headers): array {
    $ch=curl_init($url);
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>22,CURLOPT_HTTPHEADER=>$headers]);
    if ($body!==null) curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body]);
    $raw=curl_exec($ch); $status=curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
    if ($status===400 && str_ends_with($url,':batchUpdate') && is_string($raw)) {
        $message=json_decode($raw,true)['error']['message']??'';
        if (stripos($message,'protect')!==false) throw new UnexpectedValueException('Таблица запретила запись в защищённую область.');
        if (stripos($message,'validation')!==false) throw new UnexpectedValueException('Значение заказа не прошло проверку ячейки исходной таблицы.');
        if (preg_match('/requests\[(\d+)\]\.([a-zA-Z]+)/',$message,$match)) {
            throw new UnexpectedValueException('Таблица отклонила операцию '.(int)$match[1].' ('.$match[2].').');
        }
    }
    if (!is_string($raw) || $status<200 || $status>=300) throw new RuntimeException(in_array($status,[401,403,404],true)?'sheet_access_unavailable':'sheet_service_unavailable');
    $result=json_decode($raw,true);
    if (!is_array($result)) throw new RuntimeException('sheet_service_unavailable');
    return $result;
}

function sheet_token(bool $provision=false): string {
    $cfg=sheet_credentials($provision);
    $cache='eliteservice:sheets:'.sha1($cfg['client_email'].($cfg['private_key_id']??''));
    if (function_exists('apcu_fetch') && is_string($cached=apcu_fetch($cache))) return $cached;
    $base64=static fn(string $v):string=>rtrim(strtr(base64_encode($v),'+/','-_'),'=');
    $tokenUrl='https://oauth2.googleapis.com/token';
    $now=time();
    $jwt=$base64('{"alg":"RS256","typ":"JWT"}').'.'.$base64(json_encode(['iss'=>$cfg['client_email'],'scope'=>'https://www.googleapis.com/auth/spreadsheets','aud'=>$tokenUrl,'iat'=>$now,'exp'=>$now+3600],JSON_THROW_ON_ERROR));
    if (!openssl_sign($jwt,$sig,$cfg['private_key'],OPENSSL_ALGO_SHA256)) throw new RuntimeException('sheet_not_configured');
    $result=sheet_http($tokenUrl,http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt.'.'.$base64($sig)]),['Content-Type: application/x-www-form-urlencoded']);
    if (empty($result['access_token'])) throw new RuntimeException('sheet_access_unavailable');
    if (function_exists('apcu_store')) apcu_store($cache,$result['access_token'],min(3000,(int)($result['expires_in']??3000)-60));
    return $result['access_token'];
}

function sheet_api(string $token,string $suffix,?array $body=null):array {
    return sheet_http('https://sheets.googleapis.com/v4/spreadsheets/'.ORDER_BOOK.$suffix,$body===null?null:json_encode($body,JSON_THROW_ON_ERROR),['Authorization: Bearer '.$token,'Content-Type: application/json']);
}
function sheet_snapshot(string $token):array {
    $fields='sheets(properties(sheetId,title),data(rowMetadata(developerMetadata(metadataKey,metadataValue,location(dimensionRange)))))';
    $book=sheet_api($token,'?fields='.rawurlencode($fields) . '&ranges='.rawurlencode("'".ORDER_TAB."'!A:A"));
    foreach ($book['sheets']??[] as $tab) {
        if (($tab['properties']['title']??'')!==ORDER_TAB) continue;
        $sheetId=(int)$tab['properties']['sheetId']; $verified=[];
        foreach ($tab['data'][0]['rowMetadata']??[] as $dimension) foreach ($dimension['developerMetadata']??[] as $meta) {
            $range=$meta['location']['dimensionRange']??[];
            if (($meta['metadataKey']??'')!==ORDER_META_KEY || ($range['dimension']??'')!=='ROWS' || ($range['sheetId']??0)!==$sheetId) continue;
            $verified[$meta['metadataValue']][]=(int)($range['startIndex']??0)+1;
        }
        $rows=sheet_values($token,'A:W');
        sheet_order_header($rows[0]??[]);
        return [$sheetId,$verified,$rows];
    }
    throw new RuntimeException('sheet_layout_changed');
}
function sheet_values(string $token,string $range,string $render='UNFORMATTED_VALUE'):array {
    return sheet_api($token,'/values/'.rawurlencode("'".ORDER_TAB."'!".$range).'?valueRenderOption='.$render)['values']??[];
}
function sheet_matches_order(array $order,array $cells,array $row):bool {
    foreach ([16=>'cleanCheck',18=>'masterAmount',19=>'companyShare'] as $column=>$key) {
        $amount=sheet_order_amount($order[$key]??null);
        if ($amount!==null) $cells[$column]=['userEnteredValue'=>['numberValue'=>$amount]];
    }
    return sheet_order_readback($cells,$row);
}
function sheet_id(mixed $value):string {
    if (!is_string($value) || !preg_match('/^[A-Za-z0-9._-]{1,128}$/D',$value)) throw new InvalidArgumentException('invalid_order_id');
    return $value;
}
function sheet_existing(array $order,array $verified,array $rows):?int {
    $ids=$verified[$order['orderId']]??[];
    if (count($ids)>1) throw new UnexpectedValueException('sheet_row_conflict');
    if ($ids) {
        $actual=$rows[$ids[0]-1]??[];
        if (!sheet_matches_order($order,sheet_order_cells($order,$rows),$actual)) throw new UnexpectedValueException('sheet_row_changed');
        return $ids[0];
    }
    $existing=sheet_order_find($order,$rows);
    if ($existing!==null) {
        foreach ($verified as $otherId=>$locations) {
            if ($otherId!==$order['orderId'] && in_array($existing,$locations,true)) throw new UnexpectedValueException('sheet_row_conflict');
        }
    }
    return $existing;
}
function sheet_metadata_id(string $orderId):int {
    return 1+(hexdec(substr(hash('sha256',ORDER_META_KEY.':'.$orderId),0,8))%2147483646);
}
function sheet_insert_requests(string $id,int $sheetId,int $index,array $cells,?array $color=null):array {
    $target=['sheetId'=>$sheetId,'startRowIndex'=>$index,'endRowIndex'=>$index+1,'startColumnIndex'=>0,'endColumnIndex'=>23];
    $dim=['sheetId'=>$sheetId,'dimension'=>'ROWS','startIndex'=>$index,'endIndex'=>$index+1];
    $requests=[];
    // The existing row already owns native formats, validation and formulas.
    // M (salary scheme) is protected by the owner; never write or format it.
    if (isset($cells[12])) throw new UnexpectedValueException('Схему оплаты в защищённом столбце М нужно сверить владельцу.');
    if ($color!==null) {
        foreach ([[0,12],[13,23]] as [$left,$right]) {
            $range=array_replace($target,['startColumnIndex'=>$left,'endColumnIndex'=>$right]);
            $requests[]=['repeatCell'=>['range'=>$range,'cell'=>['userEnteredFormat'=>['backgroundColor'=>$color]],'fields'=>'userEnteredFormat.backgroundColor']];
        }
    }
    foreach ($cells as $column=>$value) {
        $requests[]=['updateCells'=>['start'=>['sheetId'=>$sheetId,'rowIndex'=>$index,'columnIndex'=>$column],'rows'=>[['values'=>[$value]]],'fields'=>'userEnteredValue']];
    }
    // Sheets validates this unique ID in the same atomic batch as the insertion.
    // A retry after a transport timeout cannot append a second copy.
    $requests[]=['createDeveloperMetadata'=>['developerMetadata'=>['metadataId'=>sheet_metadata_id($id),'metadataKey'=>ORDER_META_KEY,'metadataValue'=>$id,'visibility'=>'DOCUMENT','location'=>['dimensionRange'=>$dim]]]];
    return $requests;
}
function sheet_orders(PDO $pdo,array $ids):array {
    $marks=implode(',',array_fill(0,count($ids),'?'));
    $sql='SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? AND document_id IN ('.$marks.')';
    $query=$pdo->prepare($sql);
    $query->execute(array_merge([tg_workspace(),'workspaces/'.tg_workspace().'/orders'],$ids));
    $orders=[];
    foreach ($query as $row) {
        $order=json_decode($row['data_json'],true);
        if (is_array($order) && empty($order['_duplicateOf'])) {
            $order['orderId']=$row['document_id']; $orders[$row['document_id']]=$order;
        }
    }
    return $orders;
}
function sheet_dispatch(PDO $pdo,array $actor,array $input):array {
    fin_order_amount_actor($actor);
    $action=$input['action']??'send';
    if (!in_array($action,['send','status'],true)) throw new InvalidArgumentException('invalid_action');
    $ids=$action==='status'?($input['orderIds']??null):[$input['orderId']??null];
    if (!is_array($ids)||count($ids)<1||count($ids)>100) throw new InvalidArgumentException('invalid_order_ids');
    $ids=array_values(array_unique(array_map('sheet_id',$ids)));
    $token=sheet_token(($actor['role']??'')==='owner' && $action==='status');
    if ($action==='status') {
        [, $verified,$rows]=sheet_snapshot($token);
        $result=[];$uncertain=[];
        $orders=sheet_orders($pdo,$ids);
        foreach ($ids as $id) {
            if (!isset($orders[$id])) {$uncertain[]=$id;continue;}
            try { $row=sheet_existing($orders[$id],$verified,$rows); if ($row!==null) $result[$id]=$row; }
            catch (UnexpectedValueException $e) {$uncertain[]=$id;}
        }
        return ['ok'=>true,'verified'=>(object)$result,'uncertain'=>$uncertain];
    }
    $id=$ids[0];
    $lock='eliteservice-sheet-'.substr(hash('sha256',ORDER_BOOK),0,32);
    $q=$pdo->prepare('SELECT GET_LOCK(?,10)');$q->execute([$lock]);
    if ((int)$q->fetchColumn()!==1) throw new RuntimeException('sheet_busy');
    try {
        $order=sheet_orders($pdo,[$id])[$id]??null;
        if (!$order) throw new OutOfBoundsException('order_not_found');
        [$sheetId,$verified,$rows]=sheet_snapshot($token);
        $existing=sheet_existing($order,$verified,$rows);
        if ($existing!==null) return ['ok'=>true,'verified'=>true,'orderId'=>$id,'row'=>$existing];
        $index=sheet_order_template_index($rows);
        $template=sheet_values($token,'A'.($index+1).':W'.($index+1),'FORMULA')[0]??[];
        // Check the exact candidate again after selecting it; a person may have
        // filled a row directly in Sheets since we took the workbook snapshot.
        foreach ($template as $col=>$value) {
            if (in_array($col,[1,2,16,18,19],true)) continue;
            if (sheet_order_text($value)!=='') throw new UnexpectedValueException('Строка шаблона уже занята. Повторите проверку.');
        }
        if (!sheet_order_same($template[1]??'','ПК') || !sheet_order_same($template[2]??'','СПБ')) throw new UnexpectedValueException('sheet_template_changed');
        foreach ([16,18,19] as $c) if (!str_starts_with((string)($template[$c]??''),'=')) throw new UnexpectedValueException('sheet_template_changed');
        $cells=sheet_order_cells($order,$rows);
        if (!isset($cells[1],$cells[2])) throw new UnexpectedValueException('Укажите направление и город заказа.');
        sheet_api($token,':batchUpdate',['requests'=>sheet_insert_requests($id,$sheetId,$index,$cells,sheet_order_color((string)($order['_status']??'')))]);
        [, $confirmed,$after]=sheet_snapshot($token);
        $found=$confirmed[$id]??[];
        if (count($found)!==1 || !sheet_matches_order($order,$cells,$after[$found[0]-1]??[])) throw new UnexpectedValueException('sheet_readback_failed');
        return ['ok'=>true,'verified'=>true,'orderId'=>$id,'row'=>$found[0]];
    } finally { $q=$pdo->prepare('SELECT RELEASE_LOCK(?)'); $q->execute([$lock]); }
}

if (defined('ELITESERVICE_SHEET_LIBRARY')) return;
// Public keys are intended for distribution. GET never provisions or rotates.
if (($_SERVER['REQUEST_METHOD']??'GET')==='GET' && isset($_GET['certificate'])) {
    try {
        $public=sheet_public_certificate();
        header('Content-Type: application/x-pem-file'); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
        echo $public; exit;
    } catch (Throwable $e) {tg_reply(404,['ok'=>false,'error'=>'certificate_unavailable']);}
}
try {
    if (($_SERVER['REQUEST_METHOD']??'GET')!=='POST') tg_reply(405,['ok'=>false,'error'=>'method']);
    $raw=file_get_contents('php://input',false,null,0,32769);
    if (!is_string($raw)||strlen($raw)>32768) tg_reply(413,['ok'=>false,'error'=>'too_large']);
    $input=json_decode($raw,true);
    if (!is_array($input)) throw new InvalidArgumentException('invalid_json');
    $pdo=tg_db();
    tg_reply(200,sheet_dispatch($pdo,tg_jwt_actor($pdo),$input));
} catch (InvalidArgumentException $e) {tg_reply(400,['ok'=>false,'error'=>$e->getMessage()]);
} catch (DomainException $e) {tg_reply(403,['ok'=>false,'error'=>'dispatcher_required']);
} catch (OutOfBoundsException $e) {tg_reply(404,['ok'=>false,'error'=>'order_not_found']);
} catch (UnexpectedValueException $e) {tg_reply(409,['ok'=>false,'error'=>$e->getMessage()]);
} catch (Throwable $e) {
    $code=$e->getMessage();
    tg_reply(503,['ok'=>false,'error'=>in_array($code,['sheet_not_configured','sheet_access_unavailable','sheet_layout_changed','sheet_busy'],true)?$code:'sheet_service_unavailable']);
}






