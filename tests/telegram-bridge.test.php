<?php
declare(strict_types=1);
$source = file_get_contents(__DIR__ . '/../hosted-snapshot/crm-api/telegram.php');
$end = strpos($source, "\ntry {\n    if (strtoupper");
if ($end === false) throw new RuntimeException('Bridge entrypoint not found');
eval(substr($source, 5, $end - 5));
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
foreach (['Ленина 1, кв 25', 'Ленина 1, кв.25', 'Ленина 1, квартира 25', 'Ленина 1, кв №25', 'Ленина 1, квартира: 25', 'Ленина 1, 87', 'Ленина 1, 87, 7 этаж'] as $address) {
    check(tg_public_address($address) === 'Ленина 1', 'Apartment must not leak: ' . $address);
}
check(!str_contains(tg_safe_request('кв. 25, звонить +7 (999) 123-45-67'), '25'), 'Apartment in description');
check(!str_contains(tg_safe_request('кв. 25, звонить +7 (999) 123-45-67'), '123'), 'Phone in description');
check(tg_public_address('Ленина д.7, корп.1') === 'Ленина д.7, корп.1', 'Keep building corpus');
check(!str_contains(tg_safe_request('квартира: 25'), '25'), 'Colon apartment in request');
$delivery = ['masterUid' => 'm1', 'assignedAt' => '2026-10-31T10:00:00Z'];
check(tg_same_assignment($delivery, ['masterUid' => 'm1', '_assignedAt' => $delivery['assignedAt']]), 'Same delivery');
check(!tg_same_assignment($delivery, ['masterUid' => 'm2', '_assignedAt' => $delivery['assignedAt']]), 'Different master');
check(!tg_same_assignment($delivery, ['masterUid' => 'm1', '_assignedAt' => '2026-10-31T11:00:00Z']), 'New assignment to same master');
foreach (['sending', 'pending', 'accepted', 'unknown'] as $state) check(tg_blocks_resend($state), 'Must not duplicate ambiguous/active delivery');
check(!tg_blocks_resend('declined'), 'Declined delivery may be replaced');
echo "Telegram bridge regressions passed\n";

foreach (['Выполнен', 'Отказ', 'Отмена', 'Закрыт', 'Закрыто'] as $status) check(tg_order_terminal(['_status'=>$status]), 'Terminal order must not be offered or accepted');
foreach (['approved','done'] as $stage) check(tg_order_terminal(['_masterStage'=>$stage]), 'Completed stage must not regress');
foreach (['В работе','Будущая дата','Забор / техника у мастера'] as $status) check(!tg_order_terminal(['_status'=>$status]), 'Active order can be offered');

$groupPair=['telegramUserId'=>'123']; $groupLink=['telegramUserId'=>'123','chatId'=>'123'];
check(tg_group_actor_matches($groupPair,$groupLink,['chat'=>['type'=>'supergroup','id'=>'-1001'],'from'=>['id'=>123]]), 'Verified master may bind work group');
check(!tg_group_actor_matches($groupPair,$groupLink,['chat'=>['type'=>'supergroup'],'from'=>['id'=>456]]), 'Bearer link cannot let another group member claim master');
check(!tg_group_actor_matches($groupPair,$groupLink,['chat'=>['type'=>'private'],'from'=>['id'=>123]]), 'Private chat cannot become work group');
check(!tg_group_actor_matches($groupPair,['telegramUserId'=>'456'],['chat'=>['type'=>'group'],'from'=>['id'=>456]]), 'Identity changed after code issue');
check(!tg_group_actor_matches([],[],['chat'=>['type'=>'group'],'from'=>['id'=>'']]), 'Missing identity denied');

foreach ([5,6,7] as $errno) check(tg_retry_transport('sendMessage',$errno), 'Preconnection send failure can retry');
foreach ([28,35,52,56] as $errno) check(!tg_retry_transport('sendMessage',$errno), 'Ambiguous send must never retry');
check(tg_retry_transport('getMe',28), 'Safe read may fallback');
check(tg_public_ipv4('31.31.198.110')==='31.31.198.110','Public webhook IPv4');
foreach (['127.0.0.1','192.168.1.1','10.0.0.1','::1','crm.example.test'] as $ip) check(tg_public_ipv4($ip)==='', 'Unsafe/unresolved webhook IP rejected');
check(str_contains(tg_webhook_error('Read timeout expired'), 'ожидания ответа'),'Read timeout is distinct');
check(str_contains(tg_webhook_error('Connection timed out'), 'соединения'),'Connection timeout is distinct');
check(!str_contains(tg_webhook_error('Read timeout https://secret.example/token'), 'secret'), 'Diagnostics omit raw URL');

check(tg_retry_safe('getUpdates'),'Polling reads may safely retry');
check(tg_poll_offset([])===1,'Fresh polling never uses negative offset/drop');
check(tg_poll_offset(['offset'=>-42])===1,'Negative offset prohibited');
$before=['mode'=>'polling','offset'=>23,'processedCount'=>4];
$after=tg_poll_advance($before,['update_id'=>23]);
check($after['offset']===24 && $after['processedCount']===5,'Offset advances to successful update plus one');
check($before['offset']===23,'Computing next state leaves durable baseline untouched');
check(tg_poll_advance($before,['update_id'=>2])['offset']===23,'Offset never moves backward');
try {tg_poll_advance($before,['update_id'=>'bad']);throw new LogicException('Missing rejection');} catch (RuntimeException $e) {check($e->getMessage()==='Invalid update identity','Malformed update rejected');}
