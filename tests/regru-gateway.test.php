<?php
declare(strict_types=1);

putenv('B2BHELP_CONFIG=' . __DIR__ . '/../b2bhelp-gateway/regru/config.sample.php');
require_once __DIR__ . '/../b2bhelp-gateway/regru/api/index.php';

$checks = 0;
$check = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $message);
    }
    $checks++;
};

$check(in_array('https://araarkadij75-oss.github.io', allowed_origins(), true), 'known CRM origin allowed');
$check(!in_array('https://evil.example', allowed_origins(), true), 'unknown origin rejected');
$check(page_parameter('2', 1, 1000) === 2, 'valid page preserved');
$check(page_parameter('2x', 7, 1000) === 7, 'malformed page falls back');
$check(page_parameter('9999', 1, 1000) === 1000, 'page capped');
$check(page_parameter('0', 7, 1000) === 7, 'zero page rejected');
$check(safe_id('chat-123') === 'chat-123', 'ordinary chat ID accepted');
$check(safe_id("chat\n123") === '', 'control character rejected');
$check(safe_id(str_repeat('x', 241)) === '', 'oversized ID rejected');
$check(positive_id('42') === 42, 'positive account ID accepted');
$check(positive_id('0') === null, 'zero account ID rejected');
$check(positive_id('3x') === null, 'malformed account ID rejected');
$check(unicode_length(str_repeat('я', 1000)) === 1000, 'Russian text counted as characters');
$check(unicode_length(str_repeat('я', 1001)) === 1001, 'message limit can be enforced for UTF-8');
$check(clean_lead_text('Заявка с сайта', 40) === 'Заявка с сайта', 'website lead text accepts ordinary Russian');
$check(clean_lead_text(str_repeat('я', 121), 120) === null, 'website lead text limit enforced');
$privateConfigDir = sys_get_temp_dir() . '/master-ai-private-config-' . bin2hex(random_bytes(5));
mkdir($privateConfigDir, 0700, true);
$privateConfigPath = $privateConfigDir . '/config.php';
file_put_contents($privateConfigPath, '<?php return [];');
putenv('B2BHELP_CONFIG=' . $privateConfigPath);
$check(private_data_path('website-leads.json') === $privateConfigDir . '/website-leads.json', 'website leads default beside private config');
putenv('B2BHELP_CONFIG=' . __DIR__ . '/../b2bhelp-gateway/regru/config.sample.php');
unlink($privateConfigPath);
rmdir($privateConfigDir);
$publicPathRejected = false;
try {
    resolve_private_storage_path(dirname(__DIR__ . '/../b2bhelp-gateway/regru/api') . '/exposed-leads.json');
} catch (RuntimeException) {
    $publicPathRejected = true;
}
$check($publicPathRejected, 'public webroot is not accepted for private lead storage');
$tempPath = sys_get_temp_dir() . '/master-ai-lead-test-' . bin2hex(random_bytes(5)) . '.json';
$saved = mutate_private_json($tempPath, static function (array &$rows): void { $rows[] = ['id' => 'test']; });
$loaded = mutate_private_json($tempPath, static fn(array &$rows): array => $rows);
$check($loaded === [['id' => 'test']], 'private lead storage supports locked write/read');
unlink($tempPath);

fwrite(STDOUT, "REG.RU PHP gateway unit checks passed: {$checks}\n");
