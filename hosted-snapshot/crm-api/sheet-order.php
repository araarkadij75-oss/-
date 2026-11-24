<?php
declare(strict_types=1);
define('ELITESERVICE_FINANCE_LIBRARY', true);
require_once __DIR__.'/finance.php';
require_once __DIR__.'/sheet-order-map.php';

const ORDER_BOOK = '1A2qaFu8zHMwl2D-uvkGdhuX2UYUE9s4Gp1ItG4WA4Ug';
const ORDER_TAB = 'Лист1';
const ORDER_META_KEY = 'eliteservice_order_id';

function sheet_credentials(): array {
    $root = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    if (!$root) throw new RuntimeException('sheet_not_configured');
    $path = getenv('ELITESERVICE_SHEETS_CREDENTIALS');
    if (!$path) {
        $dir = $root;
        for ($i=0; $i<8 && dirname($dir)!==$dir; $i++, $dir=dirname($dir)) {
            if (is_file($dir.'/eliteservice-config.php')) { $path = $dir.'/eliteservice-sheets.json'; break; }
        }
    }
    $path = $path ? realpath($path) : false;
    if (!$path || str_starts_with($path,$root.DIRECTORY_SEPARATOR) || !is_readable($path)) throw new RuntimeException('sheet_not_configured');
    $cfg = json_decode((string)file_get_contents($path),true);
    if (($cfg['type']??'')!=='service_account' || empty($cfg['client_email']) || empty($cfg['private_key'])) throw new RuntimeException('sheet_not_configured');
    return $cfg;
}

function sheet_http(string $url, ?string $body, array $headers): array {
    $ch=curl_init($url);
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>22,CURLOPT_HTTPHEADER=>$headers]);
    if ($body!==null) curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body]);
    $raw=curl_exec($ch); $status=curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
    if (!is_string($raw) || $status<200 || $status>=300) throw new RuntimeException(in_array($status,[401,403,404],true)?'sheet_access_unavailable':'sheet_service_unavailable');
    $result=json_decode($raw,true);
    if (!is_array($result)) throw new RuntimeException('sheet_service_unavailable');
    return $result;
}

function sheet_token(): string {
    $cfg=sheet_credentials();
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
    $fields='sheets(properties(sheetId,title),developerMetadata(metadataKey,metadataValue,location(dimensionRange)))';
    $book=sheet_api($token,'?fields='.rawurlencode($fields));
    foreach ($book['sheets']??[] as $tab) {
        if (($tab['properties']['title']??'')!==ORDER_TAB) continue;
        $sheetId=(int)$tab['properties']['sheetId']; $verified=[];
        foreach ($tab['developerMetadata']??[] as $meta) {
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
function sheet_id(mixed $value):string {
    if (!is_string($value) || !preg_match('/^[A-Za-z0-9._-]{1,128}$/D',$value)) throw new InvalidArgumentException('invalid_order_id');
    return $value;
}
function sheet_existing(array $order,array $verified,array $rows):?int {
    $ids=$verified[$order['orderId']]??[];
    if (count($ids)>1) throw new UnexpectedValueException('sheet_row_conflict');
    if ($ids) {
        $actual=$rows[$ids[0]-1]??[];
        if (!sheet_order_readback(sheet_order_cells($order,$rows),$actual)) throw new UnexpectedValueException('sheet_row_changed');
        return $ids[0];
    }
    return sheet_order_find($order,$rows);
}
function sheet_metadata_id(string $orderId):int {
    return 1+(hexdec(substr(hash('sha256',ORDER_META_KEY.':'.$orderId),0,8))%2147483646);
}
function sheet_insert_requests(string $id,int $sheetId,int $index,array $cells,?array $color=null):array {
    $target=['sheetId'=>$sheetId,'startRowIndex'=>$index,'endRowIndex'=>$index+1,'startColumnIndex'=>0,'endColumnIndex'=>23];
    $source=array_merge($target,['startRowIndex'=>$index+1,'endRowIndex'=>$index+2]);
    $dim=['sheetId'=>$sheetId,'dimension'=>'ROWS','startIndex'=>$index,'endIndex'=>$index+1];
    $requests=[
        ['insertDimension'=>['range'=>$dim,'inheritFromBefore'=>false]],
        ['copyPaste'=>['source'=>$source,'destination'=>$target,'pasteType'=>'PASTE_NORMAL']],
        ['copyPaste'=>['source'=>$source,'destination'=>$target,'pasteType'=>'PASTE_DATA_VALIDATION']]
    ];
    if ($color!==null) {
        $requests[]=['repeatCell'=>['range'=>$target,'cell'=>['userEnteredFormat'=>['backgroundColor'=>$color]],'fields'=>'userEnteredFormat.backgroundColor']];
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
    $token=sheet_token();
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
        foreach ([16,18,19] as $c) if (!str_starts_with((string)($template[$c]??''),'=')) throw new UnexpectedValueException('sheet_template_changed');
        $cells=sheet_order_cells($order,$rows);
        sheet_api($token,':batchUpdate',['requests'=>sheet_insert_requests($id,$sheetId,$index,$cells,sheet_order_color((string)($order['_status']??'')))]);
        [, $confirmed,$after]=sheet_snapshot($token);
        $found=$confirmed[$id]??[];
        if (count($found)!==1 || !sheet_order_readback($cells,$after[$found[0]-1]??[])) throw new UnexpectedValueException('sheet_readback_failed');
        return ['ok'=>true,'verified'=>true,'orderId'=>$id,'row'=>$found[0]];
    } finally { $q=$pdo->prepare('SELECT RELEASE_LOCK(?)'); $q->execute([$lock]); }
}

if (defined('ELITESERVICE_SHEET_LIBRARY')) return;
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

