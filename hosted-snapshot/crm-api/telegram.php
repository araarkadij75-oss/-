<?php
declare(strict_types=1);

/*
 * EliteService Telegram bridge. Install beside crm-api/index.php.
 * The bot token is read only from the private hosting data directory.
 */
const TG_MAX_BODY = 1000000;
const TG_API_ROOT = 'https://api.telegram.org/bot';

function tg_reply(int $status, array $body): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function tg_cfg(): array {
    $docroot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), DIRECTORY_SEPARATOR);
    if ($docroot === '') throw new RuntimeException('Document root unavailable');
    $configured = getenv('ELITESERVICE_CONFIG');
    $dataDir = is_string($configured) && $configured !== '' ? dirname($configured) : '';
    if ($dataDir === '') {
        // The candidate site can be an alias/subdirectory, so DOCUMENT_ROOT
        // may differ by one or more levels between hosting configurations.
        // Locate the existing private config by filename only; never inspect
        // its contents while resolving the directory.
        $candidate = $docroot;
        for ($level = 0; $level < 8 && $candidate !== dirname($candidate); $level++, $candidate = dirname($candidate)) {
            if (is_file($candidate . '/eliteservice-config.php') && is_file($candidate . '/eliteservice-runtime.php')) {
                $dataDir = $candidate;
                break;
            }
        }
    }
    if ($dataDir === '') throw new RuntimeException('Private configuration unavailable');
    if (str_starts_with($dataDir, $docroot . DIRECTORY_SEPARATOR)) throw new RuntimeException('Private directory is inside web root');
    $privatePath = getenv('ELITESERVICE_CONFIG') ?: $dataDir . '/eliteservice-config.php';
    $runtimePath = getenv('ELITESERVICE_RUNTIME') ?: $dataDir . '/eliteservice-runtime.php';
    if (!is_file($privatePath) || !is_readable($privatePath) || !is_file($runtimePath) || !is_readable($runtimePath)) throw new RuntimeException('Private configuration unavailable');
    $private = require $privatePath;
    $runtime = require $runtimePath;
    if (!is_array($private) || !is_array($private['db'] ?? null) || !is_array($runtime)) throw new RuntimeException('Invalid configuration');
    $db = $private['db'];
    return $runtime + ['database' => [
        'host' => $db['host'] ?? '', 'port' => (int)($db['port'] ?? 3306), 'name' => $db['database'] ?? '',
        'user' => $db['username'] ?? '', 'password' => $db['password'] ?? '', 'charset' => $db['charset'] ?? 'utf8mb4',
    ]];
}

function tg_db(): PDO {
    $d = tg_cfg()['database'] ?? [];
    foreach (['host', 'name', 'user', 'password'] as $key) if (!is_string($d[$key] ?? null) || $d[$key] === '') throw new RuntimeException('Database configuration incomplete');
    $charset = preg_match('/^[a-z0-9_]+$/i', (string)($d['charset'] ?? 'utf8mb4')) ? $d['charset'] : 'utf8mb4';
    $port = max(1, min(65535, (int)($d['port'] ?? 3306)));
    return new PDO("mysql:host={$d['host']};port={$port};dbname={$d['name']};charset={$charset}", $d['user'], $d['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function tg_token(): string {
    $docroot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), DIRECTORY_SEPARATOR);
    $configuredToken = getenv('ELITESERVICE_TELEGRAM_TOKEN');
    if (is_string($configuredToken) && $configuredToken !== '') {
        $path = $configuredToken;
    } else {
        $candidate = $docroot;
        $path = '';
        for ($level = 0; $level < 8 && $candidate !== dirname($candidate); $level++, $candidate = dirname($candidate)) {
            if (is_file($candidate . '/tg-token')) { $path = $candidate . '/tg-token'; break; }
        }
        if ($path === '') throw new RuntimeException('Telegram token unavailable');
    }
    if (str_starts_with($path, $docroot . DIRECTORY_SEPARATOR) || !is_file($path) || !is_readable($path)) throw new RuntimeException('Telegram token unavailable');
    $token = trim((string)file_get_contents($path));
    if (!preg_match('/^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$/', $token)) throw new RuntimeException('Telegram token invalid');
    return $token;
}

function tg_network_code(int $errno): string {
    return match ($errno) {
        5, 6 => 'telegram_network_dns_failed',
        7 => 'telegram_network_connect_failed',
        28 => 'telegram_network_timeout',
        35, 51, 58, 60, 77, 83, 90, 91 => 'telegram_network_tls_failed',
        default => 'telegram_network_unreachable',
    };
}

function tg_retry_safe(string $method): bool {
    // Never repeat sendMessage after an ambiguous timeout: it may have arrived.
    return in_array($method, ['getMe', 'getWebhookInfo', 'setWebhook'], true);
}

function tg_call(string $method, array $payload): array {
    $url = TG_API_ROOT . tg_token() . '/' . $method;
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $raw = false;
    $errno = 0;
    if (function_exists('curl_init')) {
        // Prefer IPv4 on shared hosting; a broken IPv6 route must not stall every
        // request. Safe read/config operations may fall back to system routing.
        $routes = tg_retry_safe($method) ? [CURL_IPRESOLVE_V4, CURL_IPRESOLVE_WHATEVER] : [CURL_IPRESOLVE_V4];
        foreach ($routes as $route) {
            $ch = curl_init($url);
            if ($ch === false) break;
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT => 12,
                CURLOPT_IPRESOLVE => $route,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ]);
            $raw = curl_exec($ch);
            $errno = curl_errno($ch);
            curl_close($ch);
            if (is_string($raw)) break;
        }
    } else {
        $ctx = stream_context_create(['http' => [
        'method' => 'POST', 'timeout' => 12, 'ignore_errors' => true,
        'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
        'content' => $body,
    ], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $raw = @file_get_contents($url, false, $ctx);
    }
    $result = is_string($raw) ? json_decode($raw, true) : null;
    // Never expose curl_error(): it can include the credential-bearing URL.
    if (!is_string($raw)) throw new RuntimeException(tg_network_code($errno));
    if (!is_array($result) || !array_key_exists('ok', $result)) throw new RuntimeException('telegram_invalid_api_response');
    if (($result['ok'] ?? false) !== true) throw new RuntimeException((int)($result['error_code'] ?? 0) === 401 ? 'telegram_token_rejected' : 'telegram_api_rejected_request');
    if (!array_key_exists('result', $result)) throw new RuntimeException('telegram_invalid_api_response');
    return is_array($result['result']) ? $result['result'] : ['value' => $result['result']];
}

function tg_workspace(): string {
    $workspace = (string)(tg_cfg()['workspace_id'] ?? '');
    if ($workspace === '' || !preg_match('/^[A-Za-z0-9_-]{1,100}$/', $workspace)) throw new RuntimeException('Workspace configuration unavailable');
    return $workspace;
}

function tg_path(string $collection, string $id): string {
    if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $collection) || !preg_match('/^[A-Za-z0-9._-]{1,128}$/', $id)) throw new DomainException('Invalid document key');
    return 'workspaces/' . tg_workspace() . '/' . $collection . '/' . $id;
}

function tg_split_path(string $path): array {
    $parts = explode('/', trim($path, '/'));
    if (count($parts) !== 4 || $parts[0] !== 'workspaces' || $parts[1] !== tg_workspace() || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $parts[2]) || !preg_match('/^[A-Za-z0-9._-]{1,128}$/', $parts[3])) throw new DomainException('Invalid document path');
    return [$parts[2], $parts[3], $path];
}

function tg_read(PDO $pdo, string $path, bool $lock = false): ?array {
    [$collection, $id] = tg_split_path($path);
    $sql = 'SELECT data_json,revision FROM crm_documents WHERE workspace_id=? AND collection_path=? AND document_id=?' . ($lock ? ' FOR UPDATE' : '');
    $q = $pdo->prepare($sql);
    $q->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/' . $collection, $id]);
    $row = $q->fetch();
    if (!$row) return null;
    $data = json_decode((string)$row['data_json'], true);
    return is_array($data) ? $data : null;
}

function tg_write_many(PDO $pdo, array $writes, string $actorUid, string $role, string $eventType = 'update'): void {
    $changed = [];
    foreach ($writes as $path => $data) {
        [$collection, $id] = tg_split_path((string)$path);
        $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        $q = $pdo->prepare('INSERT INTO crm_documents(workspace_id,collection_path,document_id,data_json,revision) VALUES(?,?,?,?,1) ON DUPLICATE KEY UPDATE data_json=VALUES(data_json),revision=revision+1');
        $q->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/' . $collection, $id, $json]);
        $collectionPath = 'workspaces/' . tg_workspace() . '/' . $collection;
        $changed[$collectionPath] = true;
        $ev = $pdo->prepare('INSERT INTO crm_events(workspace_id,revision,actor_uid,actor_role,event_type,collection_path,document_id) VALUES(?,0,?,?,?,?,?)');
        $ev->execute([tg_workspace(), $actorUid, $role, $eventType, $collectionPath, $id]);
    }
    foreach (array_keys($changed) as $collectionPath) {
        $bump = $pdo->prepare('INSERT INTO crm_collection_revisions(workspace_id,collection_path,revision) VALUES(?,?,1) ON DUPLICATE KEY UPDATE revision=revision+1');
        $bump->execute([tg_workspace(), $collectionPath]);
    }
}

function tg_member(PDO $pdo, string $uid): ?array {
    return tg_read($pdo, tg_path('members', $uid));
}

function tg_master_key(string $value): string {
    $value = str_replace('ё', 'е', trim($value));
    if (function_exists('mb_strtolower')) $value = mb_strtolower($value, 'UTF-8');
    else $value = strtolower($value);
    return trim(preg_replace('/[^a-zа-я0-9]+/u', ' ', $value) ?? $value);
}

function tg_jwt_actor(PDO $pdo): array {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $auth = trim((string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $headers['Authorization'] ?? $headers['authorization'] ?? ''));
    if (!preg_match('/^Bearer\s+([A-Za-z0-9._-]+)$/i', $auth, $m)) throw new DomainException('Authentication required');
    $parts = explode('.', $m[1]);
    if (count($parts) !== 3) throw new DomainException('Invalid authentication token');
    $decode = static function (string $s): string|false { return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true); };
    $header = json_decode((string)$decode($parts[0]), true);
    $claims = json_decode((string)$decode($parts[1]), true);
    $signature = $decode($parts[2]);
    if (!is_array($header) || !is_array($claims) || !is_string($signature) || ($header['alg'] ?? '') !== 'RS256' || !is_string($header['kid'] ?? null)) throw new DomainException('Invalid authentication token');
    $project = (string)(tg_cfg()['firebase_project_id'] ?? '');
    $now = time();
    if ($project === '' || ($claims['aud'] ?? '') !== $project || ($claims['iss'] ?? '') !== 'https://securetoken.google.com/' . $project || !is_string($claims['sub'] ?? null) || $claims['sub'] === '' || strlen($claims['sub']) > 128 || !is_numeric($claims['exp'] ?? null) || (int)$claims['exp'] <= $now || !is_numeric($claims['iat'] ?? null) || (int)$claims['iat'] > $now + 60) throw new DomainException('Expired or invalid authentication token');
    $url = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
    $ctx = stream_context_create(['http' => ['timeout' => 6, 'header' => "Accept: application/json\r\n"], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $body = @file_get_contents($url, false, $ctx);
    $keys = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($keys) || !$keys) throw new RuntimeException('Authentication verifier unavailable');
    $cert = $keys[$header['kid']] ?? null;
    $x509 = is_string($cert) ? openssl_x509_read($cert) : false;
    $key = $x509 ? openssl_pkey_get_public($x509) : false;
    if (!$key || openssl_verify($parts[0] . '.' . $parts[1], $signature, $key, OPENSSL_ALGO_SHA256) !== 1) throw new DomainException('Invalid authentication token');
    $member = tg_member($pdo, $claims['sub']);
    $active = is_array($member) ? ($member['active'] ?? true) : false;
    if (!is_array($member) || !in_array($active, [true, 1, '1'], true) || !in_array($member['role'] ?? '', ['owner', 'dispatcher_logistic', 'logistic', 'master'], true)) throw new DomainException('Account is not enabled');
    return ['uid' => $claims['sub'], 'id' => (string)($member['id'] ?? $claims['sub']), 'role' => (string)$member['role'], 'name' => (string)($member['name'] ?? ''), 'master' => (string)($member['master'] ?? ''), 'shift' => (string)($member['shift'] ?? '')];
}

function tg_read_token_header(): string {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    return trim((string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? $headers['X-Telegram-Bot-Api-Secret-Token'] ?? $headers['x-telegram-bot-api-secret-token'] ?? ''));
}

function tg_webhook_secret(): string { return substr(hash_hmac('sha256', 'EliteService Telegram webhook v1', tg_token()), 0, 48); }

function tg_phone_free(string $text): string {
    return preg_replace('/(?<!\d)\+?(?:\d[\s().-]*){10,15}(?!\d)/u', '[номер скрыт]', $text) ?? $text;
}

function tg_public_address(string $address): string {
    $address = tg_phone_free(trim($address));
    $address = preg_replace('/[,;]\s*\d+[\p{L}]?(?:\s*[-\/]\s*\d+)?(?:\s*(?:кв\.?|квартира|эт\.?|этаж))?(?=\s*(?:[,;]|$)).*$/iu', '', $address) ?? $address;
    $address = preg_replace('/[,;]?\s*(?<![\p{L}])(?:квартира|кв\.?|подъезд|этаж|эт\.?|домофон(?:ный\s+код)?|код\s+домофона)(?![\p{L}]).*$/iu', '', $address) ?? $address;
    return trim($address, " \t\n\r\0\x0B,;-");
}

function tg_safe_request(string $request): string {
    $request = tg_phone_free(trim($request));
    $request = preg_replace('/(?<![\p{L}])(?:номер\s+квартиры|квартира|кв\.?)(?![\p{L}])\s*[:№#-]?\s*[\p{L}\d\/-]+/iu', '[квартира после принятия]', $request) ?? $request;
    return function_exists('mb_substr') ? mb_substr($request, 0, 2200) : substr($request, 0, 2200);
}

function tg_bot_info(): array { return tg_call('getMe', []); }

function tg_setup_webhook(): array {
    try { tg_token(); }
    catch (Throwable) { tg_reply(503, ['ok' => false, 'error' => 'telegram_token_unavailable']); }
    try { $info = tg_bot_info(); }
    catch (Throwable $e) {
        $code = $e->getMessage();
        $safe = ['telegram_network_unreachable', 'telegram_network_dns_failed', 'telegram_network_connect_failed', 'telegram_network_timeout', 'telegram_network_tls_failed', 'telegram_invalid_api_response', 'telegram_token_rejected', 'telegram_api_rejected_request'];
        tg_reply(502, ['ok' => false, 'error' => in_array($code, $safe, true) ? $code : 'telegram_api_call_failed']);
    }
    $url = 'https://crm.remontpkspb.ru/candidate/crm-api/telegram.php?webhook=1';
    try { $result = tg_call('setWebhook', ['url' => $url, 'secret_token' => tg_webhook_secret(), 'allowed_updates' => ['message', 'callback_query'], 'drop_pending_updates' => false]); }
    catch (Throwable $e) {
        $code = $e->getMessage();
        $safe = ['telegram_network_unreachable', 'telegram_network_dns_failed', 'telegram_network_connect_failed', 'telegram_network_timeout', 'telegram_network_tls_failed', 'telegram_invalid_api_response', 'telegram_token_rejected', 'telegram_api_rejected_request'];
        tg_reply(502, ['ok' => false, 'error' => in_array($code, $safe, true) ? $code : 'telegram_webhook_registration_failed']);
    }
    $set = ($result['value'] ?? false) === true;
    return ['ok' => $set, 'botUsername' => (string)($info['username'] ?? ''), 'webhookSet' => $set];
}

function tg_active_master(PDO $pdo, string $uid): ?array {
    $member = tg_member($pdo, $uid);
    if (!$member || ($member['role'] ?? '') !== 'master' || !in_array($member['active'] ?? true, [true, 1, '1'], true)) return null;
    return $member;
}

function tg_list_masters(PDO $pdo, array $actor): array {
    if ($actor['role'] !== 'owner') throw new DomainException('Только владелец может создавать приглашения');
    $collection = 'workspaces/' . tg_workspace() . '/members';
    $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=?');
    $q->execute([tg_workspace(), $collection]);
    $masters = [];
    foreach ($q->fetchAll() as $row) {
        $member = json_decode((string)$row['data_json'], true);
        if (!is_array($member) || ($member['role'] ?? '') !== 'master' || !in_array($member['active'] ?? true, [true, 1, '1'], true)) continue;
        $uid = (string)$row['document_id'];
        $name = trim((string)($member['master'] ?? $member['name'] ?? ''));
        if ($name === '') $name = 'Мастер';
        $link = tg_read($pdo, tg_path('telegramUsers', $uid));
        $masters[] = ['uid' => $uid, 'name' => $name, 'connected' => !empty($link['telegramUserId']), 'groupConnected'=>!empty($link['groupChatId']), 'groupTitle'=>(string)($link['groupTitle']??'')];
    }
    usort($masters, static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    return ['ok' => true, 'masters' => $masters];
}

function tg_new_pair_code(PDO $pdo, array $actor, string $targetUid = ''): array {
    if ($actor['role'] === 'master') $targetUid = (string)$actor['uid'];
    elseif ($actor['role'] !== 'owner' || $targetUid === '') throw new DomainException('Выберите мастера в CRM');
    $member = tg_active_master($pdo, $targetUid);
    if (!$member) throw new DomainException('Профиль мастера не найден или отключён');
    $current = tg_read($pdo, tg_path('telegramUsers', $targetUid));
    if ($current && !empty($current['chatId'])) throw new DomainException('Telegram этого мастера уже подключён');
    $code = bin2hex(random_bytes(32));
    $now = time();
    $path = tg_path('telegramPairings', hash('sha256', $code));
    $pdo->beginTransaction();
    try {
        $collection = 'workspaces/' . tg_workspace() . '/telegramPairings';
        $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? FOR UPDATE');
        $q->execute([tg_workspace(), $collection]);
        $writes = [];
        foreach ($q->fetchAll() as $row) {
            $old = json_decode((string)$row['data_json'], true);
            if (is_array($old) && (string)($old['uid'] ?? '') === $targetUid && empty($old['usedAt']) && (int)($old['expiresAt'] ?? 0) > $now) {
                $old['expiresAt'] = $now;
                $writes[tg_path('telegramPairings', (string)$row['document_id'])] = $old;
            }
        }
        $writes[$path] = ['uid' => $targetUid, 'createdByUid' => (string)$actor['uid'], 'expiresAt' => $now + 600, 'createdAt' => $now, 'usedAt' => null];
        tg_write_many($pdo, $writes, (string)$actor['uid'], (string)$actor['role'], 'telegram_pair_code');
        $pdo->commit();
    }
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    $info = tg_bot_info();
    $username = (string)($info['username'] ?? '');
    if ($username === '') throw new RuntimeException('Telegram bot identity unavailable');
    return ['ok' => true, 'botUsername' => $username, 'startLink' => 'https://t.me/' . rawurlencode($username) . '?start=' . $code, 'expiresInSeconds' => 600];
}

function tg_group_pair_code(PDO $pdo, array $actor, string $uid): array {
    if (($actor['role'] ?? '') !== 'owner') throw new DomainException('Только владелец подключает рабочие группы');
    if (!tg_active_master($pdo, $uid)) throw new DomainException('Профиль мастера недоступен');
    $link = tg_read($pdo, tg_path('telegramUsers', $uid));
    if (empty($link['telegramUserId'])) throw new DomainException('Сначала мастер должен подтвердить личный Telegram по персональной ссылке');
    if (!empty($link['groupChatId'])) throw new DomainException('Рабочая группа мастера уже подключена');
    $info = tg_bot_info(); $username = (string)($info['username'] ?? '');
    if ($username === '') throw new RuntimeException('telegram_invalid_api_response');
    $code = bin2hex(random_bytes(32)); $now = time();
    $pdo->beginTransaction();
    try {
        tg_write_many($pdo, [tg_path('telegramGroupPairings', hash('sha256', $code)) => ['uid'=>$uid, 'telegramUserId'=>(string)$link['telegramUserId'], 'createdByUid'=>(string)$actor['uid'], 'expiresAt'=>$now+600, 'usedAt'=>null]], (string)$actor['uid'], 'owner', 'telegram_group_code');
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    return ['ok'=>true, 'botUsername'=>$username, 'groupLink'=>'https://t.me/'.rawurlencode($username).'?startgroup='.$code, 'expiresInSeconds'=>600];
}

function tg_group_actor_matches(array $pair, array $link, array $msg): bool {
    return in_array($msg['chat']['type'] ?? '', ['group','supergroup'], true)
        && !empty($link['telegramUserId']) && (string)($msg['from']['id'] ?? '') === (string)$link['telegramUserId']
        && (string)($pair['telegramUserId'] ?? '') === (string)$link['telegramUserId'];
}

function tg_update_group_link(PDO $pdo, array $msg): void {
    if (!in_array($msg['chat']['type'] ?? '', ['group','supergroup'], true)) return;
    if (!preg_match('/^\/(?:start|startgroup|bind)(?:@[A-Za-z0-9_]+)?\s+([a-f0-9]{64})$/i', trim((string)($msg['text'] ?? '')), $m)) return;
    $path = tg_path('telegramGroupPairings', hash('sha256', strtolower($m[1])));
    $pdo->beginTransaction();
    try {
        $pair = tg_read($pdo, $path, true);
        if (!$pair || !empty($pair['usedAt']) || (int)($pair['expiresAt'] ?? 0) < time()) throw new DomainException('Ссылка группы истекла или использована');
        $uid = (string)$pair['uid']; $linkPath = tg_path('telegramUsers', $uid);
        $link = tg_read($pdo, $linkPath, true);
        if (!$link || !tg_group_actor_matches($pair, $link, $msg) || !tg_active_master($pdo, $uid)) throw new DomainException('Подключить группу должен сам мастер с подтверждённого Telegram');
        $chatId = (string)$msg['chat']['id'];
        if (!empty($link['groupChatId'])) throw new DomainException('Рабочая группа уже подключена');
        $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? FOR UPDATE');
        $q->execute([tg_workspace(), 'workspaces/'.tg_workspace().'/telegramUsers']);
        foreach ($q->fetchAll() as $row) {
            $other = json_decode((string)$row['data_json'], true);
            if (is_array($other) && (string)($other['groupChatId'] ?? '') === $chatId && (string)$row['document_id'] !== $uid) throw new DomainException('Группа уже связана с другим мастером');
        }
        $link['groupChatId']=$chatId; $link['groupTitle']=(string)($msg['chat']['title'] ?? 'Рабочая группа'); $link['groupLinkedAt']=time();
        $pair['usedAt']=time();
        tg_write_many($pdo, [$path=>$pair,$linkPath=>$link], $uid, 'master', 'telegram_group_pair');
        $pdo->commit();
    } catch (DomainException $e) { if ($pdo->inTransaction()) $pdo->rollBack(); tg_call('sendMessage',['chat_id'=>(string)$msg['chat']['id'],'text'=>$e->getMessage()]); return; }
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    tg_call('sendMessage',['chat_id'=>$chatId,'text'=>'Рабочая группа подключена. Новые заявки будут приходить сюда. Принимать и отклонять их может только закреплённый мастер.']);
}

function tg_bot_status(array $actor): array {
    if (($actor['role'] ?? '') !== 'owner') throw new DomainException('Только владелец может проверить подключение');
    $bot=tg_bot_info(); $info=tg_call('getWebhookInfo',[]);
    $rawError=(string)($info['last_error_message']??'');
    $safeError=$rawError===''?'':'Telegram не смог доставить обновление серверу CRM';
    if (preg_match('/(?:response|HTTP)[^0-9]*([45][0-9]{2})/i',$rawError,$match)) $safeError.=' · HTTP '.$match[1];
    elseif (stripos($rawError,'SSL')!==false || stripos($rawError,'certificate')!==false) $safeError.=' · ошибка TLS/сертификата';
    elseif (stripos($rawError,'timed out')!==false || stripos($rawError,'timeout')!==false) $safeError.=' · тайм-аут соединения';
    elseif (stripos($rawError,'resolve')!==false) $safeError.=' · ошибка DNS';
    return ['ok'=>true,'botUsername'=>(string)($bot['username']??''),'webhookConfigured'=>!empty($info['url']), 'pendingUpdateCount'=>(int)($info['pending_update_count']??0), 'lastErrorAt'=>(int)($info['last_error_date']??0), 'lastError'=>$safeError];
}

function tg_address_apartment(string $address): string { return tg_phone_free(trim($address)); }

function tg_update_member_link(PDO $pdo, array $update): void {
    $msg = $update['message'] ?? null;
    if (is_array($msg) && in_array($msg['chat']['type'] ?? '', ['group','supergroup'], true)) { tg_update_group_link($pdo, $msg); return; }
    if (!is_array($msg) || ($msg['chat']['type'] ?? '') !== 'private' || !is_array($msg['from'] ?? null)) return;
    $text = trim((string)($msg['text'] ?? ''));
    if (!preg_match('/^\/start(?:@[A-Za-z0-9_]+)?\s+([a-f0-9]{64})$/i', $text, $m)) {
        tg_call('sendMessage', ['chat_id' => (string)$msg['chat']['id'], 'text' => 'Чтобы привязать аккаунт мастера, откройте ссылку подключения в CRM и нажмите «Запустить».']);
        return;
    }
    $uidFromTg = (string)$msg['from']['id'];
    $chatId = (string)$msg['chat']['id'];
    $pairPath = tg_path('telegramPairings', hash('sha256', strtolower($m[1])));
    $pair = tg_read($pdo, $pairPath);
    if (!is_array($pair) || (int)($pair['expiresAt'] ?? 0) < time() || !empty($pair['usedAt'])) {
        tg_call('sendMessage', ['chat_id' => $chatId, 'text' => 'Ссылка подключения истекла. Создайте новую ссылку в CRM.']);
        return;
    }
    $uid = (string)($pair['uid'] ?? '');
    $member = tg_member($pdo, $uid);
    if (!$member || ($member['role'] ?? '') !== 'master' || !in_array($member['active'] ?? true, [true, 1, '1'], true)) {
        tg_call('sendMessage', ['chat_id' => $chatId, 'text' => 'Профиль мастера недоступен. Создайте новую ссылку в CRM.']);
        return;
    }
    $linkPath = tg_path('telegramUsers', $uid);
    $pdo->beginTransaction();
    try {
        $locked = tg_read($pdo, $pairPath, true);
        if (!$locked || !empty($locked['usedAt']) || (int)($locked['expiresAt'] ?? 0) < time()) throw new DomainException('Pairing code expired');
        $existingLink = tg_read($pdo, $linkPath, true);
        if ($existingLink && (string)($existingLink['telegramUserId'] ?? '') !== $uidFromTg) throw new DomainException('Telegram account already linked');
        $usersCollection = 'workspaces/' . tg_workspace() . '/telegramUsers';
        $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? FOR UPDATE');
        $q->execute([tg_workspace(), $usersCollection]);
        foreach ($q->fetchAll() as $row) {
            $x = json_decode((string)$row['data_json'], true);
            if (is_array($x) && (string)($x['telegramUserId'] ?? '') === $uidFromTg && $row['document_id'] !== $uid) throw new DomainException('Telegram account already linked');
        }
        $locked['usedAt'] = time();
        $link = ['uid' => $uid, 'telegramUserId' => $uidFromTg, 'chatId' => $chatId, 'username' => (string)($msg['from']['username'] ?? ''), 'linkedAt' => time(), 'updatedAt' => time()];
        tg_write_many($pdo, [$pairPath => $locked, $linkPath => $link], $uid, 'master', 'telegram_pair');
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    tg_call('sendMessage', ['chat_id' => $chatId, 'text' => 'Аккаунт мастера связан с CRM. Теперь откройте ссылку подключения рабочей группы от владельца. Заказы будут приходить в эту группу. Номер телефона через бота не передаётся.']);
}

function tg_same_assignment(array $delivery, array $assignment): bool {
    return (string)($delivery['masterUid'] ?? '') === (string)($assignment['masterUid'] ?? '')
        && (string)($delivery['assignedAt'] ?? '') === (string)($assignment['_assignedAt'] ?? '');
}

function tg_blocks_resend(string $state): bool {
    return in_array($state, ['sending', 'pending', 'accepted', 'unknown'], true);
}

function tg_status_for_order(PDO $pdo, array $actor, string $orderId): array {
    if (!in_array($actor['role'], ['owner', 'dispatcher_logistic', 'logistic'], true)) throw new DomainException('Недостаточно прав');
    $assignment = tg_read($pdo, tg_path('masterAssignments', $orderId));
    $masterUid = (string)($assignment['masterUid'] ?? '');
    $assignedAt = (string)($assignment['_assignedAt'] ?? '');
    $rows = $pdo->prepare("SELECT data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.orderId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.masterUid'))=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.assignedAt')), '')=? ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.createdAt')) AS UNSIGNED) DESC LIMIT 1");
    $rows->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/telegramDeliveries', $orderId, $masterUid, $assignedAt]);
    $row = $rows->fetch();
    $latest = $row ? json_decode((string)$row['data_json'], true) : null;
    if (!$latest) return ['ok' => true, 'state' => 'not_sent'];
    return ['ok' => true, 'state' => (string)($latest['state'] ?? 'unknown'), 'updatedAt' => (int)($latest['updatedAt'] ?? 0)];
}

function tg_order_terminal(array $order): bool {
    return in_array(trim((string)($order['_status'] ?? '')), ['Выполнен', 'Отказ', 'Отмена', 'Закрыт', 'Закрыто'], true)
        || in_array((string)($order['_masterStage'] ?? ''), ['approved', 'done'], true);
}

function tg_send_order(PDO $pdo, array $actor, string $orderId): array {
    if (!in_array($actor['role'], ['owner', 'dispatcher_logistic', 'logistic'], true)) throw new DomainException('Недостаточно прав');
    if (!preg_match('/^[A-Za-z0-9._-]{1,128}$/', $orderId)) throw new DomainException('Некорректный номер заказа');
    $orderPath = tg_path('orders', $orderId);
    $order = tg_read($pdo, $orderPath);
    $assignmentPath = tg_path('masterAssignments', $orderId);
    $assignment = tg_read($pdo, $assignmentPath);
    if (!$order || !$assignment || empty($order['master']) || empty($assignment['masterUid'])) throw new DomainException('Назначьте мастера в CRM перед отправкой');
    if (tg_order_terminal($order)) throw new DomainException('Заказ уже завершён или отменён. Отправка мастеру недоступна');
    $uid = (string)$assignment['masterUid'];
    $member = tg_member($pdo, $uid);
    if (!$member || ($member['role'] ?? '') !== 'master' || !in_array($member['active'] ?? true, [true, 1, '1'], true)) throw new DomainException('Профиль мастера не найден или отключён');
    $orderMaster = tg_master_key((string)($order['master'] ?? ''));
    $memberMaster = tg_master_key((string)($member['master'] ?? $member['name'] ?? ''));
    if ($orderMaster === '' || $memberMaster === '' || $orderMaster !== $memberMaster) throw new DomainException('В CRM не совпадает назначенный мастер; обновите заказ перед отправкой');
    $link = tg_read($pdo, tg_path('telegramUsers', $uid));
    if (!$link || empty($link['telegramUserId']) || empty($link['groupChatId'])) throw new DomainException('Рабочая группа мастера ещё не подключена в CRM');
    if ((string)($assignment['masterUid'] ?? '') !== $uid) throw new DomainException('Назначение изменилось; обновите заказ');
    $id = bin2hex(random_bytes(16));
    $now = time();
    $ticketPath = tg_path('telegramDeliveries', $id);
    $delivery = ['orderId' => $orderId, 'masterUid' => $uid, 'assignedAt' => (string)($assignment['_assignedAt'] ?? ''), 'chatId' => (string)$link['groupChatId'], 'state' => 'sending', 'createdAt' => $now, 'updatedAt' => $now, 'expiresAt' => $now + 7 * 86400, 'dispatcherUid' => (string)$actor['uid']];
    $pdo->beginTransaction();
    try {
        $lockedAssignment = tg_read($pdo, $assignmentPath, true);
        $lockedOrder = tg_read($pdo, $orderPath, true);
        if (!$lockedOrder || tg_order_terminal($lockedOrder)) throw new DomainException('Заказ уже завершён или отменён. Отправка мастеру недоступна');
        if (!$lockedAssignment || (string)($lockedAssignment['masterUid'] ?? '') !== $uid || (string)($lockedAssignment['_assignedAt'] ?? '') !== (string)$delivery['assignedAt']) throw new DomainException('Назначение изменилось; обновите заказ');
        $existing = tg_status_for_order($pdo, $actor, $orderId);
        if (tg_blocks_resend($existing['state'])) { $pdo->commit(); return ['ok' => true, 'state' => $existing['state'], 'alreadySent' => true]; }
        tg_write_many($pdo, [$ticketPath => $delivery], (string)$actor['uid'], (string)$actor['role'], 'telegram_send');
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    $publicAddress = tg_public_address((string)($order['address'] ?? ''));
    $request = tg_safe_request((string)($order['request'] ?? ''));
    $parts = ['Заявка ' . $orderId];
    if (!empty($order['city'])) $parts[] = 'Город: ' . tg_phone_free((string)$order['city']);
    if (!empty($order['visitDate']) || !empty($order['visitTime'])) $parts[] = 'Выезд: ' . trim((string)($order['visitDate'] ?? '') . ' ' . (string)($order['visitTime'] ?? ''));
    if ($publicAddress !== '') $parts[] = 'Адрес: ' . $publicAddress;
    if ($request !== '') $parts[] = 'Описание: ' . $request;
    $joined = implode("\n", $parts);
    $text = function_exists('mb_substr') ? mb_substr($joined, 0, 3900) : substr($joined, 0, 3900);
    try {
        $sent = tg_call('sendMessage', ['chat_id' => (string)$link['groupChatId'], 'text' => $text, 'reply_markup' => ['inline_keyboard' => [[
            ['text' => 'Принять заказ', 'callback_data' => 'accept|' . $id],
            ['text' => 'Отказаться', 'callback_data' => 'decline|' . $id],
        ]]]]);
        $pdo->beginTransaction();
        $delivery['state'] = 'pending'; $delivery['messageId'] = (int)($sent['message_id'] ?? 0); $delivery['updatedAt'] = time();
        tg_write_many($pdo, [$ticketPath => $delivery], (string)$actor['uid'], (string)$actor['role'], 'telegram_delivered');
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $delivery['state'] = 'unknown'; $delivery['updatedAt'] = time();
        try { $pdo->beginTransaction(); tg_write_many($pdo, [$ticketPath => $delivery], (string)$actor['uid'], (string)$actor['role'], 'telegram_delivery_failed'); $pdo->commit(); } catch (Throwable) { if ($pdo->inTransaction()) $pdo->rollBack(); }
        throw new RuntimeException('Доставка не подтверждена. Проверьте Telegram мастера перед повторной отправкой.');
    }
    return ['ok' => true, 'state' => 'pending'];
}

function tg_decide(PDO $pdo, array $update): void {
    $query = $update['callback_query'] ?? null;
    if (!is_array($query) || !is_array($query['message'] ?? null) || !is_array($query['from'] ?? null)) return;
    $chatId = (string)($query['message']['chat']['id'] ?? '');
    $telegramUserId = (string)($query['from']['id'] ?? '');
    $callbackId = (string)($query['id'] ?? '');
    $data = (string)($query['data'] ?? '');
    if (!preg_match('/^(accept|decline)\|([a-f0-9]{32})$/', $data, $m)) { tg_call('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => 'Кнопка недействительна']); return; }
    $uid = '';
    $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=?');
    $q->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/telegramUsers']);
    foreach ($q->fetchAll() as $row) { $x = json_decode((string)$row['data_json'], true); if (is_array($x) && (string)($x['telegramUserId'] ?? '') === $telegramUserId && (string)($x['groupChatId'] ?? '') === $chatId) { $uid = (string)$row['document_id']; break; } }
    if ($uid === '') { tg_call('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => 'Сначала привяжите аккаунт мастера в CRM']); return; }
    $ticketPath = tg_path('telegramDeliveries', $m[2]);
    $ticket = tg_read($pdo, $ticketPath);
    if (!$ticket || (string)($ticket['masterUid'] ?? '') !== $uid || (string)($ticket['chatId'] ?? '') !== $chatId || (int)($ticket['expiresAt'] ?? 0) < time()) { tg_call('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => 'Заявка недоступна или уже истекла']); return; }
    if (($ticket['state'] ?? '') !== 'pending') { tg_call('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => 'Ответ уже принят']); return; }
    $orderId = (string)$ticket['orderId'];
    $assignmentPath = tg_path('masterAssignments', $orderId);
    $orderPath = tg_path('orders', $orderId);
    $pdo->beginTransaction();
    try {
        $lockedTicket = tg_read($pdo, $ticketPath, true);
        $assignment = tg_read($pdo, $assignmentPath, true);
        $order = tg_read($pdo, $orderPath, true);
        if (!$lockedTicket || ($lockedTicket['state'] ?? '') !== 'pending' || !$assignment || !$order || tg_order_terminal($order) || (string)($assignment['masterUid'] ?? '') !== $uid || !tg_same_assignment($lockedTicket, $assignment)) throw new DomainException('Assignment is no longer active');
        $member = tg_member($pdo, $uid);
        if (!$member || ($member['role'] ?? '') !== 'master' || !in_array($member['active'] ?? true, [true, 1, '1'], true) || tg_master_key((string)($order['master'] ?? '')) !== tg_master_key((string)($member['master'] ?? $member['name'] ?? ''))) throw new DomainException('Master assignment changed');
        $state = $m[1] === 'accept' ? 'accepted' : 'declined';
        $now = time();
        $lockedTicket['state'] = $state; $lockedTicket['updatedAt'] = $now; $lockedTicket['decidedAt'] = $now;
        $order['_telegramDecision'] = $state; $assignment['_telegramDecision'] = $state;
        $writes = [$ticketPath => $lockedTicket, $orderPath => $order, $assignmentPath => $assignment];
        $fullAddress = tg_address_apartment((string)($order['address'] ?? ''));
        if ($state === 'accepted') {
            $acceptedAt = gmdate('c', $now);
            $assignment['_masterStage'] = 'accepted'; $assignment['_acceptedAt'] = $acceptedAt; $assignment['_updatedAt'] = $acceptedAt;
            if ($fullAddress !== '') $assignment['address'] = $fullAddress;
            $order['_masterStage'] = 'accepted'; $order['_acceptedAt'] = $acceptedAt; $order['_updatedAt'] = $acceptedAt;
            $writes[$assignmentPath] = $assignment; $writes[$orderPath] = $order;
        }
        tg_write_many($pdo, $writes, $uid, 'master', 'telegram_' . $state);
        $pdo->commit();
    } catch (DomainException $e) { if ($pdo->inTransaction()) $pdo->rollBack(); tg_call('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => 'Назначение изменилось. Обратитесь к диспетчеру.']); return; }
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    tg_call('answerCallbackQuery', ['callback_query_id' => $callbackId, 'text' => $state === 'accepted' ? 'Заказ принят' : 'Вы отказались от заказа']);
    $messageId = (int)($query['message']['message_id'] ?? 0);
    if ($state === 'accepted') {
        $answer = 'Заказ ' . $orderId . ' принят.' . ($fullAddress !== '' ? "\nПолный адрес: " . $fullAddress : '');
    } else {
        $answer = 'Отказ по заявке ' . $orderId . '. Свяжитесь с диспетчером, если нужна новая заявка.';
    }
    $answer = function_exists('mb_substr') ? mb_substr($answer, 0, 3900) : substr($answer, 0, 3900);
    $edit = ['chat_id' => $chatId, 'message_id' => $messageId, 'text' => $answer, 'reply_markup' => ['inline_keyboard' => []]];
    try { tg_call('editMessageText', $edit); } catch (Throwable) { /* DB decision is authoritative; webhook retry remains safe. */ }
}

function tg_webhook(PDO $pdo, array $update): void {
    $provided = tg_read_token_header();
    if ($provided === '' || !hash_equals(tg_webhook_secret(), $provided)) tg_reply(403, ['ok' => false]);
    try {
        if (isset($update['message'])) tg_update_member_link($pdo, $update);
        elseif (isset($update['callback_query'])) tg_decide($pdo, $update);
        tg_reply(200, ['ok' => true]);
    } catch (Throwable) { tg_reply(503, ['ok' => false]); }
}

try {
    if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') tg_reply(405, ['ok' => false, 'error' => 'method']);
    $raw = file_get_contents('php://input', false, null, 0, TG_MAX_BODY + 1);
    if (!is_string($raw) || strlen($raw) > TG_MAX_BODY) tg_reply(413, ['ok' => false, 'error' => 'too_large']);
    $body = json_decode($raw, true);
    if (!is_array($body)) tg_reply(400, ['ok' => false, 'error' => 'json']);
    $pdo = tg_db();
    if (($_GET['webhook'] ?? '') === '1') tg_webhook($pdo, $body);
    $actor = tg_jwt_actor($pdo);
    $op = (string)($body['op'] ?? '');
    if ($op === 'bot_status') tg_reply(200, tg_bot_status($actor));
    if ($op === 'group_pair_code') tg_reply(200, tg_group_pair_code($pdo, $actor, (string)($body['masterUid'] ?? '')));
    if ($op === 'list_masters') tg_reply(200, tg_list_masters($pdo, $actor));
    if ($op === 'pair_code') tg_reply(200, tg_new_pair_code($pdo, $actor));
    if ($op === 'owner_pair_code') tg_reply(200, tg_new_pair_code($pdo, $actor, (string)($body['masterUid'] ?? '')));
    if ($op === 'setup_webhook') {
        if ($actor['role'] !== 'owner') throw new DomainException('Только владелец может подключить бота');
        tg_reply(200, tg_setup_webhook());
    }
    if ($op === 'send_order') tg_reply(200, tg_send_order($pdo, $actor, (string)($body['orderId'] ?? '')));
    if ($op === 'order_status') tg_reply(200, tg_status_for_order($pdo, $actor, (string)($body['orderId'] ?? '')));
    tg_reply(400, ['ok' => false, 'error' => 'invalid_operation']);
} catch (DomainException $e) {
    tg_reply(403, ['ok' => false, 'error' => $e->getMessage()]);
} catch (Throwable) {
    tg_reply(503, ['ok' => false, 'error' => 'telegram_service_unavailable']);
}
