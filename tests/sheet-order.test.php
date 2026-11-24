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
