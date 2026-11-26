<?php
declare(strict_types=1);
define('ELITESERVICE_SHEET_LIBRARY',true);
require __DIR__.'/../hosted-snapshot/crm-api/sheet-order.php';

function check_sheet_send(bool $ok,string $message):void {
    if (!$ok) throw new RuntimeException($message);
}
$id='261124-001';
$cells=[7=>['userEnteredValue'=>['stringValue'=>'=literal']],17=>['userEnteredValue'=>['numberValue'=>450]]];
$requests=sheet_insert_requests($id,19,100,$cells,['red'=>1,'green'=>0.6,'blue'=>0]);
check_sheet_send(count($requests)===5,'Only two format changes, two order fields and one marker');
check_sheet_send($requests[0]['repeatCell']['range']['endColumnIndex']===12,'First color span stops before M');
check_sheet_send($requests[1]['repeatCell']['range']['startColumnIndex']===13,'Second color span starts at N');
check_sheet_send($requests[0]['repeatCell']['fields']==='userEnteredFormat.backgroundColor','Keep template formatting and validation');
check_sheet_send($requests[2]['updateCells']['rows'][0]['values'][0]===$cells[7],'Untrusted customer text stays literal');
check_sheet_send($requests[3]['updateCells']['start']['columnIndex']===17,'No overwriting financial template next to R');
try { sheet_insert_requests($id,19,100,[12=>['userEnteredValue'=>['stringValue'=>'x']]]);throw new LogicException('Protected input accepted'); }
catch (UnexpectedValueException $expected) {}
$metadata=end($requests)['createDeveloperMetadata']['developerMetadata'];
check_sheet_send($metadata['metadataValue']===$id && $metadata['location']['dimensionRange']['startIndex']===100,'Attach marker to actual row');
check_sheet_send($metadata['metadataId']===sheet_metadata_id($id),'Retries use same atomic marker');
check_sheet_send(sheet_metadata_id('261124-002')!==$metadata['metadataId'],'Distinct orders have distinct test IDs');
foreach ([null,'../bad','',str_repeat('x',129)] as $bad) {
    try {sheet_id($bad);throw new RuntimeException('Invalid id accepted');} catch(InvalidArgumentException $expected) {}
}
try {fin_order_amount_actor(['uid'=>'employee','role'=>'master']);throw new RuntimeException('Master accepted');} catch(DomainException $expected) {}
echo "Sheet order batch and authorization checks passed.\n";

$fixture=sys_get_temp_dir().DIRECTORY_SEPARATOR.'crm-sheet-'.bin2hex(random_bytes(5));
mkdir($fixture,0700);
$web=$fixture.DIRECTORY_SEPARATOR.'public';
mkdir($web,0700);
$path=$fixture.DIRECTORY_SEPARATOR.'eliteservice-sheets.json';
$_SERVER['DOCUMENT_ROOT']=$web;
putenv('ELITESERVICE_SHEETS_CREDENTIALS='.$path);
try {
    try {sheet_public_certificate();throw new LogicException('Public GET provisioned credentials');}
    catch (RuntimeException $e) {check_sheet_send(!file_exists($path),'Read-only endpoint does not provision');}
    $cfg=sheet_credentials(true);
    check_sheet_send($cfg['client_email']===ORDER_WRITER,'Limited dedicated identity');
    check_sheet_send(openssl_x509_check_private_key(sheet_public_certificate(),$cfg['private_key']),'Public certificate matches private key');
    check_sheet_send(!str_contains(sheet_public_certificate(),'PRIVATE KEY'),'No private material in certificate response');
    check_sheet_send(sheet_credentials(true)===$cfg,'Provisioning is idempotent');
    if (PHP_OS_FAMILY!=='Windows') check_sheet_send((fileperms($path)&0777)===0600,'Only owner reads private material');
    putenv('ELITESERVICE_SHEETS_CREDENTIALS='.$web.DIRECTORY_SEPARATOR.'forbidden.json');
    try {sheet_credentials(true);throw new LogicException('Created key underneath website');}
    catch (RuntimeException $e) {check_sheet_send(!file_exists($web.DIRECTORY_SEPARATOR.'forbidden.json'),'No secret in document root');}
} finally {
    if (file_exists($path)) unlink($path);
    rmdir($web);rmdir($fixture);putenv('ELITESERVICE_SHEETS_CREDENTIALS');
}
echo "Sheet certificate issuance, isolation, and readback checks passed.\n";

$header=['','нпр','Город','Дата Звонка','Время звонка','Дата выезда','Время выезд','Имя','Конт. номер','Адрес','Запрос','Мастер','ЗП','Дисп','ПП','З/Ч','Чистый чек','Общая сумма','Процент мастера','Сдача','отзыв','Дата сдачи заявки','ком'];
$orders=[]; $rows=[$header];
foreach (['Д','','С','СД/В','Avito',17] as $i=>$marker) {
    $id='case-'.$i;
    $order=['callDate'=>'2026-11-24','phone'=>'7999000000'.$i,'address'=>'Адрес '.$i,'request'=>'Заказ'];
    $orders[$id]=$order;
    $rows[]=[0=>$marker,3=>'24.11.2026',8=>$order['phone'],9=>$order['address'],10=>$order['request']];
}
$orders['missing']=['callDate'=>'2026-11-22'];
$orders['stored']=['callDate'=>'2026-11-22','a0'=>'Д'];
$rows[]=[0=>'',3=>'24.11.2026',13=>'Диспетчер'];
$channels=sheet_source_map($orders,[],$rows);
check_sheet_send(array_values($channels)===['direct','avito','seo','other','avito','other','unknown','direct'],'Classify verified A values, preserve mixed codes, never infer a missing source');
$orders['second']=$orders['case-0'];
check_sheet_send(sheet_source_map($orders,[],$rows)['case-0']==='unknown','Duplicate CRM orders must not inherit one paid source');
unset($orders['second']);$rows[]=$rows[1];
check_sheet_send(sheet_source_map($orders,[],$rows)['case-0']==='unknown','Ambiguous sheet rows must stay unresolved');
check_sheet_send(sheet_source_map($orders,['case-0'=>[2]],$rows)['case-0']==='direct','Verified order identity disambiguates duplicate historical sheet rows');
check_sheet_send(sheet_source_map($orders,['other-id'=>[3]],$rows)['case-1']==='unknown','Never assign a row already linked to another order');
