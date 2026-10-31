<?php
declare(strict_types=1);
// Run with php -n: deterministic fake cURL, no network and no real credentials.
if (extension_loaded('curl')) throw new RuntimeException('Run this test with php -n');
foreach (['CURL_IPRESOLVE_V4','CURL_IPRESOLVE_WHATEVER','CURLOPT_POST','CURLOPT_RETURNTRANSFER','CURLOPT_CONNECTTIMEOUT','CURLOPT_TIMEOUT','CURLOPT_IPRESOLVE','CURLOPT_FOLLOWLOCATION','CURLOPT_HTTPHEADER','CURLOPT_POSTFIELDS','CURLOPT_SSL_VERIFYPEER','CURLOPT_SSL_VERIFYHOST'] as $i => $name) define($name, $i + 1);
$responses = []; $requests = []; $lastErrno = 0;
function curl_init(string $url): object { return (object)['options' => []]; }
function curl_setopt_array(object $ch, array $options): bool { $ch->options = $options; return true; }
function curl_exec(object $ch): string|false {
    global $responses, $requests, $lastErrno;
    $requests[] = $ch->options;
    if (!$responses) throw new RuntimeException('Unexpected extra request');
    [$raw, $lastErrno] = array_shift($responses);
    return $raw;
}
function curl_errno(object $ch): int { global $lastErrno; return $lastErrno; }
function curl_close(object $ch): void {}
$source = file_get_contents(__DIR__ . '/../hosted-snapshot/crm-api/telegram.php');
$source = str_replace("\r\n", "\n", $source);
$end = strpos($source, "\ntry {\n    if (strtoupper");
if ($end === false) throw new RuntimeException('Entrypoint missing');
eval(substr($source, 5, $end - 5));
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$tokenFile = tempnam(sys_get_temp_dir(), 'tg-test-');
file_put_contents($tokenFile, '123456:' . str_repeat('x', 35));
putenv('ELITESERVICE_TELEGRAM_TOKEN=' . $tokenFile);
$_SERVER['DOCUMENT_ROOT'] = __DIR__ . '/fake-webroot';
try {
    $responses = [[false, 7], ['{"ok":true,"result":{"username":"test_bot"}}', 0]];
    verify(tg_call('getMe', [])['username'] === 'test_bot', 'Safe fallback failed');
    verify(count($requests) === 2, 'Safe fallback count');
    verify($requests[0][CURLOPT_IPRESOLVE] === CURL_IPRESOLVE_WHATEVER, 'Prefer system routing');
    verify($requests[1][CURLOPT_IPRESOLVE] === CURL_IPRESOLVE_V4, 'Fallback route');
    foreach ($requests as $options) {
        verify($options[CURLOPT_SSL_VERIFYPEER] === true && $options[CURLOPT_SSL_VERIFYHOST] === 2, 'TLS verification required');
        verify($options[CURLOPT_FOLLOWLOCATION] === false, 'No credential redirect');
    }
    $requests = []; $responses = [[false, 28]];
    try { tg_call('sendMessage', ['text' => 'test']); throw new RuntimeException('Expected timeout'); }
    catch (RuntimeException $e) { verify($e->getMessage() === 'telegram_network_timeout', 'Safe timeout code'); }
    verify(count($requests) === 1, 'Never duplicate ambiguous message');
    foreach ([6 => 'dns_failed', 7 => 'connect_failed', 28 => 'timeout', 60 => 'tls_failed', 99 => 'unreachable'] as $errno => $suffix) verify(tg_network_code($errno) === 'telegram_network_' . $suffix, 'Diagnostic classification');
    $responses = [['{"ok":false,"error_code":401,"description":"secret must not leak"}', 0]];
    try { tg_call('getMe', []); throw new RuntimeException('Expected rejection'); }
    catch (RuntimeException $e) { verify($e->getMessage() === 'telegram_token_rejected', 'Token response must be sanitized'); }
    $responses = [['{"ok":true,"result":false}', 0]];
    verify(tg_call('setWebhook', []) === ['value' => false], 'False result must remain false');
    echo "Telegram transport regressions passed\n";
} finally { unlink($tokenFile); putenv('ELITESERVICE_TELEGRAM_TOKEN'); }
