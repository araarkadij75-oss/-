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
check_sheet_send($requests[0]['insertDimension']['range']['startIndex']===100,'Insert before template');
check_sheet_send($requests[1]['copyPaste']['source']['startRowIndex']===101,'Template has moved after insertion');
check_sheet_send($requests[1]['copyPaste']['destination']['endColumnIndex']===23,'All 23 columns transfer');
check_sheet_send($requests[2]['copyPaste']['pasteType']==='PASTE_DATA_VALIDATION','Keep dropdowns');
check_sheet_send($requests[3]['repeatCell']['fields']==='userEnteredFormat.backgroundColor','Keep remaining format');
check_sheet_send($requests[4]['updateCells']['rows'][0]['values'][0]===$cells[7],'Untrusted customer text stays literal');
check_sheet_send($requests[5]['updateCells']['start']['columnIndex']===17,'No overwriting financial template next to R');
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
