<?php
declare(strict_types=1);
$source=file_get_contents(__DIR__.'/../hosted-snapshot/crm-api/telegram.php');
$start=strpos($source,'function tg_edit_decision(');
$end=strpos($source,'function tg_decide(', $start);
if($start===false||$end===false)throw new RuntimeException('Callback helper missing');
$fail=true; $calls=[];
function tg_call(string $method,array $payload): array {
    global $fail,$calls;
    $calls[]=[$method,$payload];
    if($fail)throw new RuntimeException('telegram_api_rejected_request');
    return ['value'=>true];
}
function tg_address_apartment(string $address): string {return preg_replace('/\+?[0-9 ()-]{10,}/','[номер скрыт]',$address);}
eval(substr($source,$start,$end-$start));
if(tg_ack_callback(['callback_query_id'=>'expired','text'=>'Принят'])!==false)throw new RuntimeException('Expired popup must be best effort');
// An expired popup cannot prevent subsequent message edit / polling offset work.
$continued=true;
if(!$continued||count($calls)!==1)throw new RuntimeException('Processing interrupted');
$fail=false;
if(!tg_ack_callback(['callback_query_id'=>'valid','text'=>'Принят']))throw new RuntimeException('Valid popup');
$decide=substr($source,$end,strpos($source,'function tg_poll_lock',$end)-$end);
if(str_contains($decide,"tg_call('answerCallbackQuery'"))throw new RuntimeException('A blocking popup path remains');
if(strpos($decide,'$pdo->commit();')>strpos($decide,"tg_ack_callback(['callback_query_id' => \$callbackId, 'text' => \$state"))throw new RuntimeException('Decision must precede popup');
echo "Callback popup regressions passed\n";

$ticket=['state'=>'accepted','orderId'=>'TEST','chatId'=>'-123','messageId'=>55];
$fail=false; tg_edit_decision($ticket,[],['address'=>'Дом 1, кв 25']);
$edit=end($calls);if($edit[0]!=='editMessageText'||$edit[1]['message_id']!==55||!str_contains($edit[1]['text'],'кв 25')||$edit[1]['reply_markup']['inline_keyboard']!==[])throw new RuntimeException('Accepted replay restores address and removes buttons');
$ticket['state']='declined';tg_edit_decision($ticket,[],['address'=>'Дом 1, кв 25']);$edit=end($calls);
if(str_contains($edit[1]['text'],'кв 25')||!str_contains($edit[1]['text'],'Отказ'))throw new RuntimeException('Declined replay must not disclose address');
$fail=true;try{tg_edit_decision($ticket,[],[]);throw new LogicException('Network failure swallowed');}catch(RuntimeException $e){if($e->getMessage()!=='telegram_api_rejected_request')throw $e;}
