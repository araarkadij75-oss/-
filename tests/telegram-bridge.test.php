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
