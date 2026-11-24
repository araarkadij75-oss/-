<?php
declare(strict_types=1);
require_once __DIR__.'/../hosted-snapshot/crm-api/sheet-order-map.php';
function map_expect(bool $ok,string $label): void {
    if (!$ok) throw new RuntimeException($label);
}
function map_reject(callable $fn,string $label): void {
    try { $fn(); } catch (UnexpectedValueException $e) { return; }
    throw new RuntimeException($label);
}
$header=explode('|','|нпр|Город|Дата Звонка|Время звонка|Дата выезда|Время выезд|Имя|Конт. номер|Адрес|Запрос|Мастер|ЗП|Дисп|ПП|З/Ч|Чистый чек|Общая сумма|Процент мастера|Сдача|отзыв|Дата сдачи заявки|ком');
$row=[3=>46350,7=>'Тест',8=>'89990000000',9=>'Тестовый адрес',10=>'Заявка',11=>'Семенов Р.'];
$template=[1=>'ПК',2=>'СПБ',16=>0,18=>0,19=>0];
$rows=[$header,$row,$template];
$order=['direction'=>'ПК','city'=>'СПб','callDate'=>'2026-11-24','visitDate'=>'24.11.2026','closeDate'=>'2026-11-24',
    'callTime'=>'11:00','visitTime'=>'12–13','phone'=>'+7 999 000-00-00','address'=>'Тестовый адрес',
    'request'=>'Заявка','name'=>'Тест','master'=>'Семёнов Роман','dispatcher'=>'Сергей',
    'total'=>8500,'parts'=>500,'cleanCheck'=>8000,'masterAmount'=>4000,'companyShare'=>4000];
map_expect(sheet_order_find($order,$rows)===2,'Historical order matched both serial date and normalized phone');
map_expect(sheet_order_template_index($rows)===2,'Template selected after last order');
map_reject(fn()=>sheet_order_find($order,[$header,$row,$row]),'Ambiguous order accepted');
map_reject(fn()=>sheet_order_find(array_merge($order,['address'=>'Другой','request'=>'Другая']),$rows),'Same phone/name silently linked');
map_reject(fn()=>sheet_order_find(array_merge($order,['phone'=>'123','callDate'=>'2026-11-23','_sourceRow'=>2]),$rows),'Stale imported row silently appended');
map_expect(sheet_order_find(array_merge($order,['callDate'=>'2026-11-23']),$rows)===null,'New order on another day');
map_reject(fn()=>sheet_order_template_index([$header,$row,$template+[22=>'Пометка']]),'Row with a comment reused');
map_reject(fn()=>sheet_order_header(array_reverse($header)),'Swapped columns accepted');
$cells=sheet_order_cells($order,$rows);
map_expect($cells[3]['userEnteredValue']['numberValue']===46350 && $cells[21]['userEnteredValue']['stringValue']==='24.11.2026','Full dates and native types');
map_expect($cells[11]['userEnteredValue']['stringValue']==='Семенов Р.','Master chip alias with ё/е');
map_expect(!isset($cells[16])&&!isset($cells[18])&&!isset($cells[19]),'Live matching formulas should remain');
map_expect($cells[8]['userEnteredValue']['stringValue']===$order['phone'],'Phone preserves formatting');
$split=sheet_order_cells(array_merge($order,['review'=>1,'masterAmount'=>4500,'companyShare'=>3500,
    '_cashReceipts'=>[['date'=>'2026-11-24','cents'=>100000],['date'=>'2026-11-25','cents'=>250000]]]),$rows);
map_expect($split[19]['userEnteredValue']['numberValue']===3500.0&&!isset($split[18]),'Manual company split feeds S formula');
map_expect(str_contains($split[22]['userEnteredValue']['stringValue'],'25.11.2026'),'Partial payments retained');
$literal=sheet_order_cells(array_merge($order,['request'=>'=IMPORTXML("example","//x")']),$rows);
map_expect(isset($literal[10]['userEnteredValue']['stringValue']),'Customer text cannot turn into formula');
$actual=array_map(fn($c)=>array_values($c['userEnteredValue'])[0],$cells);
map_expect(sheet_order_readback($cells,$actual),'Native typed readback');
$actual[17]=100;
map_expect(!sheet_order_readback($cells,$actual),'Changed money detected');
map_expect(sheet_order_color('Выполнен')===['red'=>0,'green'=>1,'blue'=>0],'Sheet status color');
echo "Sheet order mapping checks passed.\n";
