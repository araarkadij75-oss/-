<?php
declare(strict_types=1);
define('ELITESERVICE_BRIDGE_LIBRARY', true);
require_once __DIR__ . '/telegram.php';

// Working order amounts are read-only; staff do not receive policies or payroll.
function fin_order_amount_actor(array $actor): void {
    if (empty($actor['uid']) || !in_array($actor['role'] ?? '', ['owner','dispatcher_logistic','logistic'], true)) throw new DomainException('dispatcher_required');
}
function fin_order_amount_projection(array $order, string $id): array {
    $out = ['orderId'=>$id];
    foreach (['total','masterAmount','companyShare'] as $key) {
        $value = $order[$key] ?? null;
        $out[$key] = is_string($value) || is_int($value) || is_float($value) ? $value : null;
    }
    return $out;
}
function fin_order_amounts(PDO $pdo, array $actor): array {
    fin_order_amount_actor($actor);
    $q = $pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? ORDER BY document_id LIMIT 20001');
    $q->execute([tg_workspace(), 'workspaces/' . tg_workspace() . '/orders']);
    $rows = $q->fetchAll();
    if (count($rows) > 20000) throw new LengthException('order_capacity');
    $result = [];
    foreach ($rows as $row) {
        $data = json_decode((string)$row['data_json'], true);
        if (!is_array($data)) throw new RuntimeException('invalid_stored_order');
        if (!empty($data['_duplicateOf'])) continue;
        $result[] = fin_order_amount_projection($data, (string)$row['document_id']);
    }
    return ['ok'=>true,'orders'=>$result];
}

function fin_owner(array $actor): void {
    if (($actor['role'] ?? '') !== 'owner' || empty($actor['uid'])) throw new DomainException('owner_required');
}
// Staff never receive private rates or calculated amounts. Calculate from the
// stored policy before committing the operational close, not from hidden inputs.
function fin_order_money(mixed $value): int {
    if (!is_string($value) && !is_int($value) && !is_float($value)) throw new InvalidArgumentException('invalid_order_amount');
    $text = preg_replace('/[\s\x{00a0}\x{202f}]/u', '', (string)$value);
    $text = str_replace(',', '.', $text ?? '');
    if (!preg_match('/^\d+(?:\.\d{1,2})?$/', $text) || (float)$text > 1000000000) throw new InvalidArgumentException('invalid_order_amount');
    return (int)round((float)$text * 100);
}
function fin_order_plan(array $order, array $input, array $policy, bool $fixed): array {
    $total = fin_order_money($input['total'] ?? '');
    $parts = fin_order_money(($input['parts'] ?? '') === '' ? '0' : $input['parts']);
    if ($parts > $total) throw new InvalidArgumentException('parts_exceed_total');
    $review = $input['review'] ?? '';
    if (!is_string($review) && !is_bool($review) && !is_numeric($review)) throw new InvalidArgumentException('invalid_review');
    $reviewKey = function_exists('mb_strtolower') ? mb_strtolower(trim((string)$review), 'UTF-8') : trim((string)$review);
    $bonusOn = is_numeric($review) ? (float)$review != 0 : in_array($reviewKey, ['1','да','yes','true','+','есть','хороший','хорошо','получен','получили'], true);
    $savedAmounts = array_filter(['cleanCheck','masterAmount','companyShare'], static fn($k) => isset($order[$k]) && $order[$k] !== '');
    $manual = ($order['_autoFinance'] ?? null) === false || (!empty($savedAmounts) && ($order['_autoFinance'] ?? null) !== true);
    // Imported blank orders may carry zero placeholders and a manual-mode flag.
    $firstCheck = trim((string)($order['total'] ?? '')) === '' && empty($order['_cashReceipts']);
    if ($firstCheck) {
        foreach (['parts','cleanCheck','masterAmount','companyShare'] as $key) {
            $stored = trim((string)($order[$key] ?? ''));
            if ($stored !== '' && fin_order_money($stored) !== 0) { $firstCheck = false; break; }
        }
    }
    if ($manual && !$firstCheck) {
        if ($total !== fin_order_money($order['total'] ?? '') || $parts !== fin_order_money(($order['parts'] ?? '') === '' ? '0' : $order['parts']) || (string)$review !== (string)($order['review'] ?? '') || (string)($input['master'] ?? '') !== (string)($order['master'] ?? '')) throw new DomainException('manual_finance_owner_required');
        if (count($savedAmounts) !== 3) throw new DomainException('manual_finance_incomplete');
        return [];
    }
    $pick = static function (string $key, float $fallback) use ($policy): float {
        return isset($policy[$key]) && is_numeric($policy[$key]) ? (float)$policy[$key] : $fallback;
    };
    $base = $total - $parts;
    $t1 = (int)round($pick('threshold1', 4000) * 100);
    $t2 = (int)round($pick('threshold2', 8000) * 100);
    $rate = $fixed ? $pick('fixedRate', 50) : ($base < $t1 ? $pick('gridLow', 30) : ($base < $t2 ? $pick('gridMid', 40) : $pick('gridHigh', 50)));
    $bonus = $bonusOn ? min((int)round($base * .05), 100000) : 0;
    $master = min($base, (int)round($base * max(0, min(100, $rate)) / 100) + $bonus);
    $money = static fn(int $c): string => number_format($c / 100, 2, '.', '');
    return ['total'=>$money($total), 'parts'=>$money($parts), 'cleanCheck'=>$money($base), 'masterAmount'=>$money($master), 'companyShare'=>$money($base-$master), 'review'=>(string)$review, '_autoFinance'=>true];
}
function fin_order_report_locked(array $order, array $report, string $id): bool {
    $ids = static fn(string $key): array => is_array($report[$key] ?? null) ? array_map('strval', $report[$key]) : [];
    if (in_array($id, $ids('lockedOrderIds'), true) || in_array($id, $ids('paidOrderIds'), true)) return true;
    if (is_array($report['lockedOrderIds'] ?? null)) return false;
    // Merely appearing in the day's intake list must not freeze an open pickup.
    if (($order['_isPickup'] ?? false) === true || in_array($order['_status'] ?? '', ['Забор / техника у мастера','Забор / у мастера'], true)) return false;
    $date = static function (mixed $value): string {
        if (!is_string($value)) return '';
        $value = trim($value);
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/', $value, $m)) [$year,$month,$day] = [(int)$m[1],(int)$m[2],(int)$m[3]];
        elseif (preg_match('/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/', $value, $m)) [$year,$month,$day] = [(int)$m[3],(int)$m[2],(int)$m[1]];
        else return '';
        return checkdate($month,$day,$year) ? sprintf('%04d-%02d-%02d',$year,$month,$day) : '';
    };
    $intake = $date($order['callDate'] ?? $order['_createdAt'] ?? '');
    return $intake !== '' && $intake === $date($report['date'] ?? '') && in_array($id, $ids('orderIds'), true);
}
function fin_order_calculate(PDO $pdo, array $actor, array $body): array {
    if (!in_array($actor['role'] ?? '', ['dispatcher_logistic','logistic'], true) || empty($actor['uid'])) throw new DomainException('logistics_required');
    $id = fin_text($body['orderId'] ?? '', 128);
    $path = tg_path('orders', $id);
    $expected = fin_text($body['expectedUpdatedAt'] ?? '', 80);
    $pdo->beginTransaction();
    try {
        $order = tg_read($pdo, $path, true);
        if (!$order) throw new DomainException('save_order_before_closing');
        $projection = tg_read($pdo, tg_path('dispatcherOrders', $id), true) ?? [];
        if (!empty($order['_reportLockId']) || !empty($projection['_reportLockId']) || !empty($order['_duplicateOf'])) throw new DomainException('order_locked');
        if ((string)($order['_updatedAt'] ?? '') !== $expected) throw new DomainException('order_changed_refresh');
        $reports = $pdo->prepare('SELECT data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? LIMIT 10001');
        $reports->execute([tg_workspace(), 'workspaces/'.tg_workspace().'/shiftReports']);
        $reportRows = $reports->fetchAll();
        if (count($reportRows) > 10000) throw new DomainException('order_lock_verification_unavailable');
        foreach ($reportRows as $row) {
            $report = json_decode((string)$row['data_json'], true);
            if (!is_array($report)) throw new DomainException('order_lock_verification_unavailable');
            if (fin_order_report_locked($order, $report, $id)) throw new DomainException('order_locked');
        }
        $policy = tg_read($pdo, tg_path('config', 'financePolicy')) ?? [];
        $public = tg_read($pdo, tg_path('config', 'public')) ?? [];
        $master = fin_text($body['master'] ?? '', 250);
        $fixed = false;
        foreach (($public['fixedMasters'] ?? []) as $name) if (is_string($name) && tg_master_key($name) === tg_master_key($master)) $fixed = true;
        $q = $pdo->prepare('SELECT data_json FROM crm_documents WHERE workspace_id=? AND collection_path=?');
        $q->execute([tg_workspace(), 'workspaces/'.tg_workspace().'/members']);
        foreach ($q->fetchAll() as $row) {
            $member = json_decode((string)$row['data_json'], true);
            if (is_array($member) && ($member['role'] ?? '') === 'master' && tg_master_key((string)($member['master'] ?? $member['name'] ?? '')) === tg_master_key($master)) $fixed = $fixed || ($member['fixedMaster'] ?? false) === true;
        }
        $patch = fin_order_plan($order, $body, $policy, $fixed);
        fin_check_order_receipts(array_replace($order,$patch),($body['closing'] ?? true) !== false);
        $changed = false;
        foreach ($patch as $key=>$value) if (($order[$key] ?? null) !== $value) $changed = true;
        if ($changed) {
            $next = array_replace($order, $patch);
            $next['_financeCalculatedAt'] = gmdate('c');
            $next['_financeCalculatedBy'] = (string)$actor['uid'];
            // Do not stamp a cash date or payroll payment here. The normal
            // operational commit remains responsible for confirming closure.
            $closePath = tg_path('orderCloseData', $id);
            $close = tg_read($pdo, $closePath, true) ?? ['orderId'=>$id];
            foreach (['total','parts','companyShare'] as $key) $close[$key] = $next[$key];
            tg_write_many($pdo, [$path=>$next, $closePath=>$close], (string)$actor['uid'], (string)$actor['role'], 'order_finance_calculated');
        }
        $pdo->commit();
        return ['ok'=>true, 'changed'=>$changed];
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
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
    if ($source === 'avito' && str_starts_with($normalized['externalId'], 'b2bhelp-day:') &&
        (!fin_daily_summary($normalized) || $normalized['account'] === '' || $kind !== 'expense' || isset($normalized['periodFrom']))) throw new InvalidArgumentException('invalid_daily_summary');
    return $normalized;
}
function fin_daily_summary(array $row): bool {
    return ($row['source'] ?? '') === 'avito' && ($row['externalId'] ?? '') === 'b2bhelp-day:' . $row['date'];
}

// Keep daily ledger entries authoritative. A matching detailed statement is a
// verification; ambiguous or incomplete statements must not change the ledger.
function fin_covered_expenses(array $rows, array $existing): array {
    $days = [];
    foreach ($existing as $prior) {
        if (($prior['active'] ?? true) && fin_daily_summary($prior)) $days[$prior['account']][$prior['date']] = $prior['amountCents'];
    }
    if (!$days) return [];
    $groups = [];
    foreach ($rows as $row) {
        if ($row['source'] !== 'avito' || fin_daily_summary($row)) continue;
        $account = $row['account'];
        $from = $row['periodFrom'] ?? $row['date'];
        $to = $row['periodTo'] ?? $row['date'];
        if ($account === '') {
            foreach ($days as $calendar) foreach ($calendar as $date => $_) {
                if ($date >= $from && $date <= $to) throw new UnexpectedValueException('expense_account_required');
            }
            continue;
        }
        $calendar = $days[$account] ?? [];
        $coverage = array_filter($calendar, static fn($date) => $date >= $from && $date <= $to, ARRAY_FILTER_USE_KEY);
        if (!$coverage) continue;
        $length = (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days + 1;
        if (count($coverage) !== $length) throw new UnexpectedValueException('expense_partial_coverage');
        $key = $from . '|' . $to . '|' . (isset($row['periodFrom']) ? 'period' : 'day');
        $id = fin_id($row);
        if (isset($groups[$account][$key]['rows'][$id]) && $groups[$account][$key]['rows'][$id] !== $row) throw new UnexpectedValueException('expense_conflict');
        $groups[$account][$key]['rows'][$id] = $row;
        $groups[$account][$key]['days'] = $coverage;
    }
    $skip = [];
    foreach ($groups as $sets) {
        $used = [];
        foreach ($sets as $group) {
            if (array_intersect_key($used, $group['days'])) throw new UnexpectedValueException('expense_partial_coverage');
            $used += $group['days'];
            $net = 0;
            foreach ($group['rows'] as $id => $row) {
                $net += $row['kind'] === 'refund' ? -$row['amountCents'] : $row['amountCents'];
                $skip[$id] = true;
            }
            if ($net !== array_sum($group['days'])) throw new UnexpectedValueException('expense_coverage_mismatch');
        }
    }
    return $skip;
}
function fin_overlap(array $existing, array $row): bool {
    if (($existing['active'] ?? true) === false || ($existing['source'] ?? '') !== 'avito' || ($row['source'] ?? '') !== 'avito') return false;
    if (fin_daily_summary($existing) || fin_daily_summary($row)) {
        $daily = fin_daily_summary($existing) ? $existing : $row;
        $other = fin_daily_summary($existing) ? $row : $existing;
        if ($daily['date'] < ($other['periodFrom'] ?? $other['date']) || $daily['date'] > ($other['periodTo'] ?? $other['date'])) return false;
        if (($other['account'] ?? '') === '') throw new UnexpectedValueException('expense_account_required');
        return $daily['account'] === $other['account'];
    }
    if (($existing['account'] ?? '') !== ($row['account'] ?? '')) return false;
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
        $covered = fin_covered_expenses($normalized, $existing);
        foreach ($normalized as $row) {
            $id = fin_id($row);
            if (isset($map[$id])) {
                if (fin_normalize($map[$id]) !== $row) throw new UnexpectedValueException('expense_conflict');
                $duplicates++;
                continue;
            }
            if (isset($covered[$id])) continue;
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
        return ['ok' => true, 'inserted' => $inserted, 'covered' => count($covered), 'duplicates' => $duplicates, 'expenses' => array_values($map)];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    } finally {
        $unlock = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $unlock->execute([$lockName]);
    }
}

function fin_payment_normalize(array $body): array {
    if (($body['kind'] ?? '') === 'settlement_baseline') {
        if (($body['baselineConfirmed'] ?? false) !== true) throw new InvalidArgumentException('baseline_confirmation_required');
        $date=fin_text($body['date']??'',10);$person=$body['person']??'';
        if(!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/',$date,$m)||!checkdate((int)$m[2],(int)$m[3],(int)$m[1])||$date<'2026-09-15'||$date>(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d')||!in_array($person,['sergey','artem'],true))throw new InvalidArgumentException('invalid_baseline');
        $days=$body['days']??null;$seen=[];$amount=0;
        if(!is_array($days)||!count($days)||count($days)>2000)throw new InvalidArgumentException('invalid_baseline_days');
        foreach($days as $d){$key=$d['date']??'';$cash=$d['cashCents']??null;if(!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/',$key,$dm)||!checkdate((int)$dm[2],(int)$dm[3],(int)$dm[1])||$key>$date||$key<'2026-09-15'||isset($seen[$key])||!is_int($cash)||$cash<0||$cash>100000000000)throw new InvalidArgumentException('invalid_baseline_day');$seen[$key]=true;$amount+=max(200000,(int)round($cash/10));}
        $key=fin_text($body['idempotencyKey']??'',128);$reference=fin_text($body['reference']??'',200);$note=fin_text($body['note']??'',4000);
        if(!preg_match('/^[A-Za-z0-9_-]{16,128}$/',$key)||$reference===''||$note==='')throw new InvalidArgumentException('baseline_evidence_required');
        return ['kind'=>'settlement_baseline','date'=>$date,'person'=>$person,'amountCents'=>$amount,'days'=>array_map(fn($d)=>['date'=>$d['date'],'cashCents'=>$d['cashCents']],$days),'reference'=>$reference,'note'=>$note,'idempotencyKey'=>$key,'baselineConfirmed'=>true];
    }
    if (($body['legacyExcluded'] ?? null) !== true) throw new InvalidArgumentException('legacy_exclusion_required');
    foreach (['reportId','shiftReportId','legacyReportId','reportIds','paidOrderIds','orderIds'] as $key) if (array_key_exists($key, $body)) throw new InvalidArgumentException('legacy_payment_binding_forbidden');
    $date = fin_text($body['date'] ?? '', 10);
    $today = (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))->format('Y-m-d');
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1]) || $date < '2026-11-02' || $date > $today) throw new InvalidArgumentException('invalid_payment_date');
    $amount = $body['amountCents'] ?? null;
    if (!is_int($amount) || $amount <= 0 || $amount > 100000000000) throw new InvalidArgumentException('invalid_amount_cents');
    $person = $body['person'] ?? null;
    if (!in_array($person, ['sergey','artem'], true)) throw new InvalidArgumentException('invalid_payment_person');
    $key = fin_text($body['idempotencyKey'] ?? '', 128);
    if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/', $key)) throw new InvalidArgumentException('invalid_idempotency_key');
    $reference = fin_text($body['reference'] ?? '', 200);
    if ($reference === '') throw new InvalidArgumentException('payment_reference_required');
    // Reference is an immutable receipt/transfer identifier, not a legacy shift ID.
    return ['date'=>$date,'person'=>$person,'amountCents'=>$amount,'reference'=>$reference,'note'=>fin_text($body['note'] ?? '',4000),'idempotencyKey'=>$key,'legacyExcluded'=>true];
}
function fin_payment_plan(array $existing, array $actor, array $body, string $now): array {
    fin_owner($actor);
    $op=$body['op']??'';$map=[];
    foreach($existing as $row)$map[$row['id']]=$row;
    if($op==='payroll_payments_add'){
        $row=fin_payment_normalize($body);$id=hash('sha256','payroll-payment:'.$row['idempotencyKey']);
        if(isset($map[$id])){
            $prior=$map[$id];foreach($row as $key=>$value)if(($prior[$key]??null)!==$value)throw new UnexpectedValueException('payment_conflict');
            return ['payment'=>$prior,'changed'=>false,'duplicate'=>true];
        }
        // Case folding prevents a retry with a new request ID from reusing the same receipt.
        $reference=function(string $value):string{return function_exists('mb_strtolower')?mb_strtolower($value,'UTF-8'):strtolower($value);};
        foreach($map as $prior)if(($prior['person']??'')===$row['person']&&$reference((string)($prior['reference']??''))===$reference($row['reference']))throw new UnexpectedValueException('payment_reference_exists');
        if(($row['kind']??'')==='settlement_baseline')foreach($map as $prior)if(($prior['active']??true)!==false&&($prior['kind']??'')==='settlement_baseline'&&$prior['person']===$row['person']&&$prior['date']>=$row['date'])throw new UnexpectedValueException('baseline_already_exists');
        if(count($map)>=20000)throw new LengthException('payment_capacity');
        return ['payment'=>$row+['id'=>$id,'active'=>true,'createdAt'=>$now,'updatedAt'=>$now,'createdBy'=>$actor['uid'],'updatedBy'=>$actor['uid']],'changed'=>true,'duplicate'=>false];
    }
    if($op!=='payroll_payments_void')throw new InvalidArgumentException('invalid_operation');
    $id=$body['id']??null;$reason=fin_text($body['reason']??'',1000);
    if(!is_string($id)||!preg_match('/^[a-f0-9]{64}$/',$id)||$reason==='')throw new InvalidArgumentException('invalid_payment_void');
    if(!isset($map[$id]))throw new OutOfBoundsException('payment_not_found');
    $payment=$map[$id];if(($payment['active']??true)===false)return ['payment'=>$payment,'changed'=>false,'duplicate'=>true];
    $payment['active']=false;$payment['voidReason']=$reason;$payment['voidedAt']=$now;$payment['voidedBy']=$actor['uid'];$payment['updatedAt']=$now;$payment['updatedBy']=$actor['uid'];
    return ['payment'=>$payment,'changed'=>true,'duplicate'=>false];
}
function fin_payments_list(PDO $pdo,array $actor):array{
    fin_owner($actor);$q=$pdo->prepare('SELECT document_id,data_json FROM crm_documents WHERE workspace_id=? AND collection_path=? ORDER BY document_id LIMIT 20001');
    $q->execute([tg_workspace(),'workspaces/'.tg_workspace().'/payrollPayments']);$rows=$q->fetchAll();if(count($rows)>20000)throw new LengthException('payment_capacity');$result=[];
    foreach($rows as $row){$data=json_decode((string)$row['data_json'],true);if(!is_array($data))throw new RuntimeException('invalid_stored_payment');$data['id']=(string)$row['document_id'];$result[]=$data;}return $result;
}
function fin_payments_mutate(PDO $pdo,array $actor,array $body):array{
    fin_owner($actor);$lockName='payroll:'.substr(hash('sha256',tg_workspace()),0,48);$lock=$pdo->prepare('SELECT GET_LOCK(?,10)');$lock->execute([$lockName]);if((int)$lock->fetchColumn()!==1)throw new RuntimeException('payroll_busy');
    try{$pdo->beginTransaction();$existing=fin_payments_list($pdo,$actor);$plan=fin_payment_plan($existing,$actor,$body,gmdate('c'));
        if($plan['changed'])tg_write_many($pdo,[tg_path('payrollPayments',$plan['payment']['id'])=>$plan['payment']],(string)$actor['uid'],'owner',$body['op']==='payroll_payments_add'?'payroll_payment_recorded':'payroll_payment_voided');
        $pdo->commit();return ['ok'=>true,'payment'=>$plan['payment'],'duplicate'=>$plan['duplicate'],'payments'=>fin_payments_list($pdo,$actor)];
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}finally{$unlock=$pdo->prepare('SELECT RELEASE_LOCK(?)');$unlock->execute([$lockName]);}
}

function fin_receipts_total(mixed $entries,string $intake=''):int {
    if(!is_array($entries)||array_values($entries)!==$entries||count($entries)>100)throw new InvalidArgumentException('invalid_cash_receipts');
    $dates=[];$total=0;
    foreach($entries as $entry){
        if(!is_array($entry)||count($entry)!==2||!isset($entry['date'],$entry['cents']))throw new InvalidArgumentException('invalid_cash_receipts');
        $date=$entry['date'];$cents=$entry['cents'];
        if(!is_string($date)||!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D',$date,$m)||!checkdate((int)$m[2],(int)$m[3],(int)$m[1])||$date<$intake||isset($dates[$date]))throw new InvalidArgumentException('invalid_receipt_date');
        if(!is_int($cents)||$cents<=0||$cents>100000000000-$total)throw new InvalidArgumentException('invalid_receipt_amount');
        $dates[$date]=true;$total+=$cents;
    }
    return $total;
}
function fin_refund_date(mixed $value): string {
    if(!is_string($value))return '';
    if(preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/D',$value,$m))$value=sprintf('%04d-%02d-%02d',$m[3],$m[2],$m[1]);
    return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D',$value,$m)&&checkdate((int)$m[2],(int)$m[3],(int)$m[1])?$value:'';
}
function fin_validate_refund_entries(mixed $entries): void {
    if(!is_array($entries)||array_values($entries)!==$entries||count($entries)>100)throw new InvalidArgumentException('invalid_cash_refunds');
    $ids=[];
    foreach($entries as $event){
        if(!is_array($event)||count($event)!==4||!isset($event['id'],$event['date'],$event['companyCents'],$event['masterCents']))throw new InvalidArgumentException('invalid_cash_refund');
        $id=$event['id'];
        if(!is_string($id)||!preg_match('/^[a-zA-Z0-9._-]{1,100}$/D',$id)||isset($ids[$id]))throw new InvalidArgumentException('invalid_refund_id');
        $ids[$id]=true;
        if(fin_refund_date($event['date'])===''||fin_refund_date($event['date'])!==$event['date'])throw new InvalidArgumentException('invalid_refund_date');
        foreach(['companyCents','masterCents'] as $key)if(!is_int($event[$key])||$event[$key]<0||$event[$key]>100000000000)throw new InvalidArgumentException('invalid_refund_amount');
        if($event['companyCents']+$event['masterCents']===0)throw new InvalidArgumentException('empty_refund');
    }
}
function fin_check_order_refunds(array $order): void {
    $refunds=$order['_cashRefunds']??[];
    fin_validate_refund_entries($refunds);
    if(!$refunds)return;
    $receipts=$order['_cashReceipts']??[];
    if(!$receipts){
        $date=fin_refund_date(($order['_cashClosedOn']??'')?:($order['closeDate']??''));
        if($date==='')throw new InvalidArgumentException('missing_refund_receipt_date');
        $receipts=[['date'=>$date,'cents'=>fin_order_money($order['companyShare']??null)]];
    }
    usort($refunds,static fn($a,$b)=>strcmp($a['date'],$b['date']));
    $today=(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d');
    $company=0;$master=0;$intake=fin_refund_date($order['callDate']??'');
    foreach($refunds as $event){
        if(!$intake||$event['date']<$intake||$event['date']>$today)throw new InvalidArgumentException('invalid_refund_date');
        $company+=$event['companyCents'];$master+=$event['masterCents'];
        $available=0;
        foreach($receipts as $receipt)if($receipt['date']<=$event['date'])$available+=$receipt['cents'];
        if($company>$available||$master>fin_order_money($order['masterAmount']??null))throw new InvalidArgumentException('refund_exceeds_order');
    }
}
function fin_check_order_receipts(array $order,bool $closing=false):void {
    fin_check_order_refunds($order);
    $entries=$order['_cashReceipts']??[];
    if($entries===[])return;
    $intake=(string)($order['callDate']??'');
    if(preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/',$intake,$d))$intake=sprintf('%04d-%02d-%02d',(int)$d[3],(int)$d[2],(int)$d[1]);
    if(!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D',$intake,$d)||!checkdate((int)$d[2],(int)$d[3],(int)$d[1]))throw new InvalidArgumentException('invalid_receipt_intake');
    $total=fin_receipts_total($entries,$intake);
    $company=fin_order_money($order['companyShare']??null);
    $closed=$closing||($order['_status']??'')==='Выполнен'||!empty($order['_cashClosedAt'])||!empty($order['_cashClosedOn']);
    if($total>$company||($closed&&$total!==$company))throw new InvalidArgumentException('cash_receipts_total_mismatch');
}
function fin_plan_receipts(array $order,array $body,string $today):array {
    if(!empty($order['_duplicateOf']))throw new DomainException('order_locked');
    $previous=$order['_cashReceipts']??null;
    $entries=$body['receipts']??null;
    fin_receipts_total($entries);
    if(!array_key_exists('before',$body)||!isset($body['expectedUpdatedAt'],$body['companyShareCents'])||!is_string($body['expectedUpdatedAt'])||!is_int($body['companyShareCents']))throw new InvalidArgumentException('receipt_snapshot_required');
    $before=$body['before'];if($before!==null)fin_receipts_total($before);
    if($body['companyShareCents']!==fin_order_money($order['companyShare']??null))throw new UnexpectedValueException('order_changed_refresh');
    foreach($entries as $e)if($e['date']>$today)throw new InvalidArgumentException('future_receipt');
    $next=array_replace($order,['_cashReceipts'=>$entries]);
    fin_check_order_receipts($next);
    if($previous===$entries)return ['changed'=>false,'order'=>$order];
    if($body['expectedUpdatedAt']!==($order['_updatedAt']??'')||$previous!==$before)throw new UnexpectedValueException('order_changed_refresh');
    return ['changed'=>true,'order'=>$next];
}
function fin_save_receipts(PDO $pdo,array $actor,array $body):array {
    fin_owner($actor);$id=fin_text($body['orderId']??'',128);
    if(!preg_match('/^[A-Za-z0-9._-]{1,128}$/D',$id))throw new InvalidArgumentException('invalid_order_id');
    $path=tg_path('orders',$id);$pdo->beginTransaction();
    try{
        $order=tg_read($pdo,$path,true);if(!$order)throw new OutOfBoundsException('order_not_found');
        $plan=fin_plan_receipts($order,$body,(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d'));
        if(!$plan['changed']){$pdo->commit();return ['ok'=>true,'changed'=>false,'updatedAt'=>$order['_updatedAt']??''];}
        $actorId=(string)$actor['uid'];$stamp=gmdate('c');$next=$plan['order'];$next['_updatedAt']=$stamp;$next['_updatedBy']=$actorId;
        $auditId=bin2hex(random_bytes(16));
        $audit=['id'=>$auditId,'orderId'=>$id,'actorUid'=>$actorId,'appliedAt'=>$stamp,'before'=>['_cashReceipts'=>$order['_cashReceipts']??null],'after'=>['_cashReceipts'=>$next['_cashReceipts']]];
        $closePath=tg_path('orderCloseData',$id);$close=tg_read($pdo,$closePath,true);
        $writes=[$path=>$next,tg_path('reconciliationAudit',$auditId)=>$audit];
        if($close!==null)$writes[$closePath]=fin_reconciliation_projection($close,$audit['after'],'orderCloseData',$stamp);
        tg_write_many($pdo,$writes,$actorId,'owner','order_cash_receipts');$pdo->commit();
        return ['ok'=>true,'changed'=>true,'updatedAt'=>$stamp];
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}
function fin_reconciliation_patch(array $patch): array {
    $allowed=['closeDate','companyShare','dispatcher','_status','masterAmount','total','parts','cleanCheck','pp','_duplicateOf','_cashClosedOn','_autoFinance','_cashReceipts','_cashRefunds'];
    $id=fin_text($patch['orderId']??'',128);
    if(!preg_match('/^[A-Za-z0-9._-]{1,128}$/',$id))throw new InvalidArgumentException('invalid_order_id');
    $before=$patch['before']??null;$after=$patch['after']??null;
    if(!is_array($before)||!is_array($after)||!count($after))throw new InvalidArgumentException('invalid_patch');
    $bk=array_keys($before);$ak=array_keys($after);sort($bk);sort($ak);
    if($bk!==$ak||array_diff($ak,$allowed))throw new InvalidArgumentException('invalid_patch_fields');
    foreach($before as $k=>$v)if(!(in_array($k,['_cashReceipts','_cashRefunds'],true)&&is_array($v))&&!is_null($v)&&!is_string($v)&&!is_int($v)&&!is_float($v)&&!($k==='_autoFinance'&&is_bool($v)))throw new InvalidArgumentException('invalid_before');
    foreach($after as $key=>$value){
        if($key==='_cashReceipts')fin_receipts_total($value);
        elseif($key==='_cashRefunds'){
            fin_validate_refund_entries($value);
            $prior=$before[$key]??[];fin_validate_refund_entries($prior);
            if(array_slice($value,0,count($prior))!=$prior)throw new InvalidArgumentException('immutable_cash_refunds');
        }
        elseif($key==='_autoFinance'){if(!is_bool($value))throw new InvalidArgumentException('invalid_auto_finance');}
        elseif(in_array($key,['companyShare','masterAmount','total','parts','cleanCheck','pp'],true)){
            if(!is_string($value)&&!is_int($value)&&!is_float($value))throw new InvalidArgumentException('invalid_cash');
            if($value!==''&&!preg_match('/^\d+(?:\.\d{1,2})?$/',(string)$value)||(float)$value>1000000000)throw new InvalidArgumentException('invalid_cash');
        }else{
            if(!is_string($value)||strlen($value)>200)throw new InvalidArgumentException('invalid_patch_value');
            if(in_array($key,['closeDate','_cashClosedOn'],true)&&$value!==''){
                if(!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/',$value,$m)||!checkdate((int)$m[2],(int)$m[3],(int)$m[1]))throw new InvalidArgumentException('invalid_close_date');
            }
            if($key==='_duplicateOf'&&$value!==''&&(!preg_match('/^[A-Za-z0-9._-]{1,128}$/',$value)||$value===$id))throw new InvalidArgumentException('invalid_duplicate_target');
            if($key==='_status'&&!in_array($value,['В работе','Забор / техника у мастера','Будущая дата','На проверке','Выполнен','Отказ','Отмена'],true))throw new InvalidArgumentException('invalid_status');
        }
    }
    $source=fin_text($patch['sourceSpreadsheet']??'',500);
    $row=$patch['sourceRow']??null;
    if($source===''||!is_int($row)||$row<1)throw new InvalidArgumentException('source_required');
    return ['orderId'=>$id,'_id'=>isset($patch['_id'])?fin_text($patch['_id'],200):null,'before'=>$before,'after'=>$after,'sourceRow'=>$row,'sourceSpreadsheet'=>$source];
}
function fin_reconciliation_matches(array $order,array $patch): bool {
    if((string)($order['orderId']??'')!==$patch['orderId'])return false;
    if($patch['_id']!==null&&($order['_id']??null)!==$patch['_id'])return false;
    foreach($patch['before'] as $key=>$value){
        if($value===null){if(array_key_exists($key,$order))return false;}
        elseif(!array_key_exists($key,$order)||$order[$key]!==$value)return false;
    }
    return true;
}
function fin_reconciliation_effective_patch(array $order,array $patch): array {
    if(array_intersect(array_keys($patch['after']),['companyShare','masterAmount','total','parts','cleanCheck','pp'])){
        $patch['before']['_autoFinance']=$order['_autoFinance']??null;
        $patch['after']['_autoFinance']=false;
    }
    return $patch;
}
function fin_reconciliation_projection(array $projection,array $after,string $collection,string $stamp): array {
    $allowed=$collection==='orderCloseData'?['companyShare','closeDate','total','parts','_cashClosedOn','_duplicateOf','_cashReceipts','_cashRefunds']:['closeDate','dispatcher','_status','_duplicateOf'];
    foreach($after as $key=>$value)if(in_array($key,$allowed,true))$projection[$key]=$value;
    $projection['_updatedAt']=$stamp;
    return $projection;
}
function fin_reconcile(PDO $pdo,array $actor,array $body): array {
    fin_owner($actor);
    $patches=$body['patches']??null;
    if(!is_array($patches)||count($patches)<1||count($patches)>200)throw new InvalidArgumentException('invalid_patch_count');
    $normalized=[];$seen=[];
    foreach($patches as $patch){if(!is_array($patch))throw new InvalidArgumentException('invalid_patch');$p=fin_reconciliation_patch($patch);if(isset($seen[$p['orderId']]))throw new InvalidArgumentException('duplicate_patch_order');$seen[$p['orderId']]=true;$normalized[]=$p;}
    $applied=[];$conflicts=[];
    foreach($normalized as $patch){
        $pdo->beginTransaction();
        try{
            $path=tg_path('orders',$patch['orderId']);$order=tg_read($pdo,$path,true);
            if(!$order||!fin_reconciliation_matches($order,$patch)){$pdo->rollBack();$conflicts[]=['orderId'=>$patch['orderId'],'reason'=>$order?'before_mismatch':'not_found'];continue;}
            if(!empty($patch['after']['_duplicateOf'])){$target=tg_read($pdo,tg_path('orders',$patch['after']['_duplicateOf']),true);if(!$target||!empty($target['_duplicateOf'])){$pdo->rollBack();$conflicts[]=['orderId'=>$patch['orderId'],'reason'=>'invalid_duplicate_target'];continue;}}
            $patch=fin_reconciliation_effective_patch($order,$patch);
            fin_check_order_receipts(array_replace($order,$patch['after']));
            $stamp=gmdate('c');$auditId=bin2hex(random_bytes(16));
            $audit=$patch+['id'=>$auditId,'actorUid'=>(string)$actor['uid'],'appliedAt'=>$stamp];
            foreach($patch['after'] as $key=>$value)$order[$key]=$value;
            $order['_updatedAt']=$stamp;$order['_updatedBy']=(string)$actor['uid'];
            $order['_sourceReconciliation']=['auditId'=>$auditId,'sourceRow'=>$patch['sourceRow'],'sourceSpreadsheet'=>$patch['sourceSpreadsheet'],'appliedAt'=>$stamp,'actorUid'=>(string)$actor['uid']];
            $writes=[$path=>$order,tg_path('reconciliationAudit',$auditId)=>$audit];
            foreach(['dispatcherOrders','masterAssignments','orderCloseData'] as $collection){
                $projectionPath=tg_path($collection,$patch['orderId']);$projection=tg_read($pdo,$projectionPath,true);
                if(!$projection)continue;
                $writes[$projectionPath]=fin_reconciliation_projection($projection,$patch['after'],$collection,$stamp);
            }
            tg_write_many($pdo,$writes,(string)$actor['uid'],'owner','source_reconciliation');$pdo->commit();$applied[]=$patch['orderId'];
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();$conflicts[]=['orderId'=>$patch['orderId'],'reason'=>'save_failed'];}
    }
    return ['ok'=>true,'applied'=>$applied,'conflicts'=>$conflicts];
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
    if (($body['op'] ?? '') === 'order_calculate') tg_reply(200, fin_order_calculate($pdo, $actor, $body));
    if (($body['op'] ?? '') === 'order_amounts') tg_reply(200, fin_order_amounts($pdo, $actor));
    fin_owner($actor);
    if (($body['op'] ?? '') === 'payroll_payments_list') tg_reply(200,['ok'=>true,'payments'=>fin_payments_list($pdo,$actor)]);
    if (in_array($body['op'] ?? '', ['payroll_payments_add','payroll_payments_void'], true)) tg_reply(200,fin_payments_mutate($pdo,$actor,$body));
    if (($body['op'] ?? '') === 'cash_receipts') tg_reply(200,fin_save_receipts($pdo,$actor,$body));
    if (($body['op'] ?? '') === 'reconcile') tg_reply(200,fin_reconcile($pdo,$actor,$body));
    if (($body['op'] ?? '') === 'list') tg_reply(200, ['ok' => true, 'expenses' => fin_list($pdo, $actor)] + fin_reports($pdo, $actor));
    tg_reply(200, fin_mutate($pdo, $actor, $body));
} catch (InvalidArgumentException $e) { tg_reply(400, ['ok' => false, 'error' => $e->getMessage()]);
} catch (DomainException $e) { tg_reply(403, ['ok' => false, 'error' => $e->getMessage()]);
} catch (UnexpectedValueException $e) { tg_reply(409, ['ok' => false, 'error' => in_array($e->getMessage(),['expense_overlap','expense_account_required','expense_partial_coverage','expense_coverage_mismatch','payment_conflict','payment_reference_exists','order_changed_refresh'],true) ? $e->getMessage() : 'expense_conflict']);
} catch (OutOfBoundsException $e) { tg_reply(404, ['ok' => false, 'error' => in_array($e->getMessage(),['order_not_found','payment_not_found'],true)?$e->getMessage():'expense_not_found']);
} catch (LengthException $e) { tg_reply(413, ['ok' => false, 'error' => 'expense_capacity']);
} catch (Throwable $e) { tg_reply(503, ['ok' => false, 'error' => 'finance_service_unavailable']); }
