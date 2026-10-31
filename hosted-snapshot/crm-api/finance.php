<?php
declare(strict_types=1);
define('ELITESERVICE_BRIDGE_LIBRARY', true);
require_once __DIR__ . '/telegram.php';

function fin_owner(array $actor): void {
    if (($actor['role'] ?? '') !== 'owner' || empty($actor['uid'])) throw new DomainException('owner_required');
}
function fin_text(mixed $value, int $max): string {
    if (!is_string($value)) throw new InvalidArgumentException('invalid_text');
    $value = preg_replace('/\s+/u', ' ', trim($value));
    if (!is_string($value) || strlen($value) > $max || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) throw new InvalidArgumentException('invalid_text');
    return $value;
}
function fin_normalize(array $row): array {
    $date = fin_text($row['date'] ?? '', 10);
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1]) || (int)$m[1] < 2000 || (int)$m[1] > 2100) throw new InvalidArgumentException('invalid_date');
    $amount = $row['amountCents'] ?? null;
    if (!is_int($amount) || $amount <= 0 || $amount > 100000000000) throw new InvalidArgumentException('invalid_amount_cents');
    $source = fin_text($row['source'] ?? '', 20);
    $kind = fin_text($row['kind'] ?? 'expense', 20);
    if (!in_array($source, ['avito', 'manual', 'legacy'], true) || !in_array($kind, ['expense', 'refund'], true)) throw new InvalidArgumentException('invalid_source_or_kind');
    $category = fin_text($row['category'] ?? 'Прочие', 200);
    if ($category === '') throw new InvalidArgumentException('category_required');
    $normalized = ['date' => $date, 'amountCents' => $amount, 'kind' => $kind, 'category' => $category, 'source' => $source, 'externalId' => fin_text($row['externalId'] ?? '', 200), 'account' => fin_text($row['account'] ?? '', 200), 'note' => fin_text($row['note'] ?? '', 4000)];
    if (array_key_exists('periodFrom', $row) || array_key_exists('periodTo', $row)) {
        foreach (['periodFrom', 'periodTo'] as $key) {
            $v = fin_text($row[$key] ?? '', 10);
            if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1]) || (int)$m[1] < 2000 || (int)$m[1] > 2100) throw new InvalidArgumentException('invalid_period');
            $normalized[$key] = $v;
        }
        if ($normalized['periodFrom'] > $normalized['periodTo'] || $date !== $normalized['periodTo']) throw new InvalidArgumentException('invalid_period');
    }
    if (array_key_exists('statisticId', $row)) $normalized['statisticId'] = fin_text($row['statisticId'], 200);
    return $normalized;
}
function fin_overlap(array $existing, array $row): bool {
    if (($existing['active'] ?? true) === false || ($existing['source'] ?? '') !== 'avito' || ($row['source'] ?? '') !== 'avito' || ($existing['account'] ?? '') !== ($row['account'] ?? '')) return false;
    $ep = isset($existing['periodFrom'], $existing['periodTo']);
    $rp = isset($row['periodFrom'], $row['periodTo']);
    if (!$ep && !$rp) return false;
    if ($ep && $rp) {
        if ($existing['periodTo'] < $row['periodFrom'] || $row['periodTo'] < $existing['periodFrom']) return false;
        $a = $existing['statisticId'] ?? '';
        $b = $row['statisticId'] ?? '';
        // Distinct explicit ad IDs are independent. Without identity, an
        // overlap is ambiguous and must be reviewed rather than double-counted.
        return $a === '' || $b === '' || $a === $b;
    }
    $period = $ep ? $existing : $row;
    $transaction = $ep ? $row : $existing;
    return $transaction['date'] >= $period['periodFrom'] && $transaction['date'] <= $period['periodTo'];
}
function fin_id(array $row): string {
    $identity = $row['externalId'] !== '' ? [$row['source'], $row['account'], $row['externalId']] : $row;
    return hash('sha256', json_encode($identity, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
}
function fin_list(PDO $pdo, array $actor): array {
    fin_owner($actor);
    $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? ORDER BY document_id LIMIT 20001');
    $q->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/financeExpenses']);
    $rows = $q->fetchAll();
    if (count($rows) > 20000) throw new LengthException('expense_capacity');
    $result = [];
    foreach ($rows as $row) {
        $data = json_decode((string)$row['data_json'], true);
        if (!is_array($data)) throw new RuntimeException('invalid_stored_expense');
        $data['id'] = (string)$row['document_id'];
        $result[] = $data;
    }
    return $result;
}
function fin_reports(PDO $pdo, array $actor): array {
    fin_owner($actor);
    $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? ORDER BY document_id LIMIT 10001');
    $q->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/shiftReports']);
    $rows = $q->fetchAll();
    $truncated = count($rows) > 10000;
    $result = [];
    foreach (array_slice($rows, 0, 10000) as $row) {
        $data = json_decode((string)$row['data_json'], true);
        if (!is_array($data)) throw new RuntimeException('invalid_stored_report');
        $data['id'] = (string)$row['document_id'];
        $result[] = $data;
    }
    return ['shiftReports' => $result, 'reportsTruncated' => $truncated];
}
function fin_mutate(PDO $pdo, array $actor, array $body): array {
    fin_owner($actor);
    $op = $body['op'] ?? '';
    $normalized = [];
    if ($op === 'import') {
        $rows = $body['rows'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || count($rows) < 1 || count($rows) > 1000) throw new InvalidArgumentException('invalid_rows');
        foreach ($rows as $row) {
            if (!is_array($row)) throw new InvalidArgumentException('invalid_row');
            $normalized[] = fin_normalize($row);
        }
    } elseif ($op === 'void') {
        if (!is_string($body['id'] ?? null) || !preg_match('/^[a-f0-9]{64}$/', $body['id']) || !is_bool($body['active'] ?? null)) throw new InvalidArgumentException('invalid_void');
    } else throw new InvalidArgumentException('invalid_operation');
    $lockName = 'finance:' . substr(hash('sha256', tg_workspace()), 0, 48);
    $lock = $pdo->prepare('SELECT GET_LOCK(?,10)');
    $lock->execute([$lockName]);
    if ((int)$lock->fetchColumn() !== 1) throw new RuntimeException('finance_busy');
    try {
        $pdo->beginTransaction();
        $existing = fin_list($pdo, $actor);
        $map = [];
        foreach ($existing as $row) $map[$row['id']] = $row;
        $writes = [];
        $inserted = 0;
        $duplicates = 0;
        $now = gmdate('c');
        foreach ($normalized as $row) {
            $id = fin_id($row);
            if (isset($map[$id])) {
                if (fin_normalize($map[$id]) !== $row) throw new UnexpectedValueException('expense_conflict');
                $duplicates++;
                continue;
            }
            foreach ($map as $prior) if (fin_overlap($prior, $row)) throw new UnexpectedValueException('expense_overlap');
            if (count($map) >= 20000) throw new LengthException('expense_capacity');
            $data = $row + ['id' => $id, 'active' => true, 'createdAt' => $now, 'updatedAt' => $now, 'createdBy' => $actor['uid'], 'updatedBy' => $actor['uid']];
            $map[$id] = $data;
            $writes[tg_path('financeExpenses', $id)] = $data;
            $inserted++;
        }
        if ($op === 'void') {
            $id = $body['id'];
            if (!isset($map[$id])) throw new OutOfBoundsException('expense_not_found');
            if ($body['active']) foreach ($map as $otherId => $prior) if ($otherId !== $id && fin_overlap($prior, $map[$id])) throw new UnexpectedValueException('expense_overlap');
            if (($map[$id]['active'] ?? true) !== $body['active']) {
                $map[$id]['active'] = $body['active'];
                $map[$id]['updatedAt'] = $now;
                $map[$id]['updatedBy'] = $actor['uid'];
                $writes[tg_path('financeExpenses', $id)] = $map[$id];
            }
        }
        if ($writes) tg_write_many($pdo, $writes, (string)$actor['uid'], 'owner', $op === 'import' ? 'finance_import' : 'finance_active_changed');
        $pdo->commit();
        return ['ok' => true, 'inserted' => $inserted, 'duplicates' => $duplicates, 'expenses' => array_values($map)];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    } finally {
        $unlock = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $unlock->execute([$lockName]);
    }
}

if (defined('ELITESERVICE_FINANCE_LIBRARY') && ELITESERVICE_FINANCE_LIBRARY) return;
try {
    if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') tg_reply(405, ['ok' => false, 'error' => 'method']);
    $raw = file_get_contents('php://input', false, null, 0, TG_MAX_BODY + 1);
    if (!is_string($raw) || strlen($raw) > TG_MAX_BODY) tg_reply(413, ['ok' => false, 'error' => 'too_large']);
    $body = json_decode($raw, true);
    if (!is_array($body)) throw new InvalidArgumentException('invalid_json');
    $pdo = tg_db();
    $actor = tg_jwt_actor($pdo);
    fin_owner($actor);
    if (($body['op'] ?? '') === 'list') tg_reply(200, ['ok' => true, 'expenses' => fin_list($pdo, $actor)] + fin_reports($pdo, $actor));
    tg_reply(200, fin_mutate($pdo, $actor, $body));
} catch (InvalidArgumentException $e) { tg_reply(400, ['ok' => false, 'error' => $e->getMessage()]);
} catch (DomainException $e) { tg_reply(403, ['ok' => false, 'error' => $e->getMessage()]);
} catch (UnexpectedValueException $e) { tg_reply(409, ['ok' => false, 'error' => $e->getMessage() === 'expense_overlap' ? 'expense_overlap' : 'expense_conflict']);
} catch (OutOfBoundsException $e) { tg_reply(404, ['ok' => false, 'error' => 'expense_not_found']);
} catch (LengthException $e) { tg_reply(413, ['ok' => false, 'error' => 'expense_capacity']);
} catch (Throwable $e) { tg_reply(503, ['ok' => false, 'error' => 'finance_service_unavailable']); }
