<?php
declare(strict_types=1);

const B2BHELP_API_ORIGIN = 'https://dev.b2b-help.ru';
const MAX_BODY_BYTES = 32768;

function gateway_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $configPath = getenv('B2BHELP_CONFIG');
    if (!is_string($configPath) || $configPath === '') {
        // The API is deployed at /www/<domain>/api. Keep secrets in the hosting
        // account's data directory, outside the public www directory.
        $configPath = dirname(__DIR__, 3) . '/b2bhelp-config.php';
    }

    if (!is_file($configPath) || !is_readable($configPath)) {
        $config = [];
        return $config;
    }

    $loaded = require $configPath;
    $config = is_array($loaded) ? $loaded : [];
    return $config;
}

function allowed_origins(): array
{
    $config = gateway_config();
    $origins = $config['CRM_ALLOWED_ORIGINS'] ?? ['https://araarkadij75-oss.github.io'];
    if (is_string($origins)) {
        $origins = explode(',', $origins);
    }
    if (!is_array($origins)) {
        return [];
    }
    return array_values(array_filter(array_map(
        static fn($origin): string => is_string($origin) ? trim($origin) : '',
        $origins
    ), static fn(string $origin): bool => $origin !== ''));
}

function respond(int $status, array $data, string $origin = ''): never
{
    if ($origin !== '' && in_array($origin, allowed_origins(), true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function request_origin(): string
{
    return isset($_SERVER['HTTP_ORIGIN']) && is_string($_SERVER['HTTP_ORIGIN'])
        ? trim($_SERVER['HTTP_ORIGIN'])
        : '';
}

function preflight(string $origin): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'OPTIONS') {
        return;
    }
    if ($origin === '' || !in_array($origin, allowed_origins(), true)) {
        respond(403, ['ok' => false, 'error' => 'origin'], $origin);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Max-Age: 600');
    header('Vary: Origin');
    http_response_code(204);
    exit;
}

function header_value(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$key]) && is_string($_SERVER[$key])) {
        return trim($_SERVER[$key]);
    }
    if ($name === 'Authorization') {
        foreach (['REDIRECT_HTTP_AUTHORIZATION', 'HTTP_AUTHORIZATION'] as $authKey) {
            if (isset($_SERVER[$authKey]) && is_string($_SERVER[$authKey])) {
                return trim($_SERVER[$authKey]);
            }
        }
    }
    return '';
}

function http_json(string $url, string $method = 'GET', array $headers = [], ?array $body = null, float $timeout = 4.5): array
{
    $headers[] = 'Accept: application/json';
    $content = null;
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        $content = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($content)) {
            throw new RuntimeException('json_encode_failed');
        }
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $content ?? '',
            'timeout' => $timeout,
            'ignore_errors' => true,
            'follow_location' => 0,
            'max_redirects' => 0,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $responseBody = @file_get_contents($url, false, $context);
    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/', $line, $matches)) {
            $status = (int)$matches[1];
            break;
        }
    }
    if (!is_string($responseBody)) {
        throw new RuntimeException('upstream_unavailable');
    }
    $decoded = json_decode($responseBody, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('invalid_upstream_response');
    }
    return ['status' => $status, 'data' => $decoded];
}

function authorize_request(string $origin): array
{
    if ($origin === '' || !in_array($origin, allowed_origins(), true)) {
        respond(403, ['ok' => false, 'error' => 'origin'], $origin);
    }

    $authorization = header_value('Authorization');
    if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
        respond(401, ['ok' => false, 'error' => 'auth'], $origin);
    }
    $idToken = trim($matches[1]);
    $config = gateway_config();
    $apiKey = is_string($config['FIREBASE_WEB_API_KEY'] ?? null) ? $config['FIREBASE_WEB_API_KEY'] : '';
    if ($apiKey === '' || $idToken === '') {
        respond(401, ['ok' => false, 'error' => 'auth'], $origin);
    }

    try {
        $lookup = http_json(
            'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' . rawurlencode($apiKey),
            'POST', [], ['idToken' => $idToken], 1.8
        );
        $user = $lookup['data']['users'][0] ?? null;
    } catch (Throwable $error) {
        respond(503, ['ok' => false, 'error' => 'auth_unavailable'], $origin);
    }
    if ($lookup['status'] < 200 || $lookup['status'] >= 300 || !is_array($user) || !is_string($user['localId'] ?? null)) {
        respond(401, ['ok' => false, 'error' => 'auth'], $origin);
    }

    $project = is_string($config['FIREBASE_PROJECT_ID'] ?? null) ? $config['FIREBASE_PROJECT_ID'] : 'master-ai-beta-9440599';
    $workspace = is_string($config['FIREBASE_WORKSPACE_ID'] ?? null) ? $config['FIREBASE_WORKSPACE_ID'] : 'master-ai-beta';
    $memberUrl = 'https://firestore.googleapis.com/v1/projects/' . rawurlencode($project)
        . '/databases/(default)/documents/workspaces/' . rawurlencode($workspace)
        . '/members/' . rawurlencode($user['localId']);
    try {
        $memberResponse = http_json($memberUrl, 'GET', ['Authorization: Bearer ' . $idToken], null, 1.8);
    } catch (Throwable $error) {
        respond(503, ['ok' => false, 'error' => 'membership_unavailable'], $origin);
    }
    if ($memberResponse['status'] === 401) {
        respond(401, ['ok' => false, 'error' => 'auth'], $origin);
    }
    if ($memberResponse['status'] === 429 || $memberResponse['status'] >= 500 || $memberResponse['status'] === 0) {
        respond(503, ['ok' => false, 'error' => 'membership_unavailable'], $origin);
    }
    $member = $memberResponse['status'] === 200 ? ($memberResponse['data']['fields'] ?? []) : [];
    $role = is_string($member['role']['stringValue'] ?? null) ? $member['role']['stringValue'] : '';
    $active = !array_key_exists('active', $member) || ($member['active']['booleanValue'] ?? false) === true;
    if (!$active || !in_array($role, ['owner', 'dispatcher_logistic'], true)) {
        respond(403, ['ok' => false, 'error' => 'role'], $origin);
    }
    return ['role' => $role, 'config' => $config];
}

function page_parameter($value, int $fallback, int $maximum): int
{
    if (!is_string($value) && !is_int($value)) {
        return $fallback;
    }
    $raw = (string)$value;
    if (!preg_match('/^[1-9][0-9]*$/', $raw)) {
        return $fallback;
    }
    return min((int)$raw, $maximum);
}

function safe_id($value): string
{
    if (!is_string($value) && !is_int($value)) {
        return '';
    }
    $id = trim((string)$value);
    return $id !== '' && strlen($id) <= 240 && !preg_match('/[\x00-\x1F\x7F]/', $id) ? $id : '';
}

function positive_id($value): ?int
{
    if (!is_string($value) && !is_int($value)) {
        return null;
    }
    $raw = (string)$value;
    if (!preg_match('/^[1-9][0-9]*$/', $raw)) {
        return null;
    }
    $number = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    return $number === false ? null : (int)$number;
}

function unicode_length(string $value): ?int
{
    $length = preg_match_all('/./us', $value);
    return $length === false ? null : $length;
}

function upstream(string $path, string $method, array $query, ?array $body, string $token, string $origin): mixed
{
    if (!preg_match('#^/msg-center/[A-Za-z0-9/_-]+$#', $path)) {
        respond(400, ['ok' => false, 'error' => 'route'], $origin);
    }
    $url = B2BHELP_API_ORIGIN . $path;
    if ($query !== []) {
        $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }
    try {
        $response = http_json($url, $method, ['Authorization: ' . $token], $body, 4.5);
    } catch (Throwable $error) {
        respond(502, ['ok' => false, 'error' => 'upstream'], $origin);
    }
    $payload = $response['data'];
    if ($response['status'] < 200 || $response['status'] >= 300 || (($payload['status'] ?? null) === false)) {
        $upstreamStatus = $response['status'];
        $status = in_array($upstreamStatus, [401, 403], true) ? 502 : (($upstreamStatus >= 500 || $upstreamStatus === 429) ? 503 : 400);
        respond($status, ['ok' => false, 'error' => $status === 503 ? 'upstream_unavailable' : ($status === 400 ? 'upstream_rejected' : 'upstream')], $origin);
    }
    return array_key_exists('result', $payload) ? ($payload['result'] ?? new stdClass()) : $payload;
}

function read_json_body(string $origin): array
{
    $length = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
    if ($length > MAX_BODY_BYTES) {
        respond(413, ['ok' => false, 'error' => 'body_too_large'], $origin);
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if (!is_string($raw) || strlen($raw) > MAX_BODY_BYTES) {
        respond(413, ['ok' => false, 'error' => 'body_too_large'], $origin);
    }
    if ($raw === '') {
        return [];
    }
    $body = json_decode($raw);
    if (!is_object($body)) {
        respond(400, ['ok' => false, 'error' => 'invalid_body'], $origin);
    }
    return (array)$body;
}

function main(): void
{
    $origin = request_origin();
    preflight($origin);
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $path = is_string($path) ? rtrim($path, '/') : '';
    $route = preg_replace('#^/api#', '', $path);
    $route = $route === '' ? '/' : $route;
    $knownRoutes = ['/health', '/accounts', '/chats', '/pull', '/messages', '/read', '/send'];
    if (!in_array($route, $knownRoutes, true)) {
        respond(404, ['ok' => false, 'error' => 'not_found'], $origin);
    }

    $allowedMethod = in_array($route, ['/read', '/send'], true) ? 'POST' : 'GET';
    if ($method !== $allowedMethod) {
        respond(405, ['ok' => false, 'error' => 'method'], $origin);
    }

    $body = $method === 'POST' ? read_json_body($origin) : [];
    $auth = authorize_request($origin);
    $config = $auth['config'];
    if ($route === '/health') {
        respond(200, [
            'ok' => true,
            'integration' => 'b2bhelp-message-center',
            'directAvito' => false,
            'configured' => ['token' => is_string($config['B2BHELP_API_TOKEN'] ?? null) && $config['B2BHELP_API_TOKEN'] !== ''],
        ], $origin);
    }

    $token = is_string($config['B2BHELP_API_TOKEN'] ?? null) ? trim($config['B2BHELP_API_TOKEN']) : '';
    if ($token === '') {
        respond(503, ['ok' => false, 'error' => 'b2bhelp_not_configured'], $origin);
    }

    $page = page_parameter($_GET['page'] ?? null, 1, 1000);
    $limit = page_parameter($_GET['limit'] ?? null, 50, 50);
    if ($route === '/accounts') {
        $result = upstream('/msg-center/accounts', 'GET', ['page' => $page, 'limit' => $limit], null, $token, $origin);
        respond(200, ['ok' => true, 'accounts' => is_array($result) && array_is_list($result) ? $result : []], $origin);
    }
    if ($route === '/chats' || $route === '/pull') {
        $result = upstream('/msg-center/chats', 'GET', ['page' => $page, 'limit' => $limit], null, $token, $origin);
        respond(200, ['ok' => true, 'chats' => is_array($result) && array_is_list($result) ? $result : []], $origin);
    }
    if ($route === '/messages') {
        $chatId = safe_id($_GET['chat_id'] ?? null);
        $accountId = positive_id($_GET['account_id'] ?? null);
        if ($chatId === '' || $accountId === null) {
            respond(400, ['ok' => false, 'error' => 'fields'], $origin);
        }
        $result = upstream('/msg-center/chat/messages', 'GET', [
            'chat_id' => $chatId, 'account_id' => $accountId, 'page' => $page, 'limit' => $limit,
        ], null, $token, $origin);
        respond(200, ['ok' => true, 'result' => $result], $origin);
    }
    $chatId = safe_id($body['chat_id'] ?? null);
    $accountId = positive_id($body['account_id'] ?? null);
    if ($chatId === '' || $accountId === null) {
        respond(400, ['ok' => false, 'error' => 'fields'], $origin);
    }
    if ($route === '/read') {
        $result = upstream('/msg-center/chat/read', 'POST', [], ['chat_id' => $chatId, 'account_id' => $accountId], $token, $origin);
        respond(200, ['ok' => true, 'result' => $result], $origin);
    }
    $text = $body['text'] ?? null;
    $textLength = is_string($text) ? unicode_length($text) : null;
    if (!is_string($text) || trim($text) === '' || $textLength === null || $textLength > 1000) {
        respond(400, ['ok' => false, 'error' => 'fields'], $origin);
    }
    $result = upstream('/msg-center/chat/messsage/send', 'POST', [], [
        'account_id' => $accountId, 'chat_id' => $chatId, 'text' => trim($text),
    ], $token, $origin);
    respond(200, ['ok' => true, 'result' => $result], $origin);
}

if (PHP_SAPI !== 'cli') {
    main();
}
