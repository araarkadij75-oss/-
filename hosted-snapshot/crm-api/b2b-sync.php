<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(405); exit; }
define('ELITESERVICE_FINANCE_LIBRARY', true);
require_once __DIR__ . '/finance.php';

function b2b_day(array $reply, string $date): array {
    if (($reply['status'] ?? false) !== true) throw new RuntimeException('B2BHelp did not confirm success');
    $accounts = array_values(array_filter($reply['result']['accounts'] ?? [], static fn($a) =>
        (string)($a['platform_account_id'] ?? '') === '49275' && (string)($a['avito_user_id'] ?? '') === '135807984'));
    if (count($accounts) !== 1) throw new RuntimeException('Expected one matching account');
    $a = $accounts[0];
    if (empty($a['is_active']) || !empty($a['error']) || ($a['period']['from'] ?? '') !== $date || ($a['period']['to'] ?? '') !== $date)
        throw new RuntimeException('Incomplete account or period');
    if (count($a['expenses'] ?? []) !== 1 || count($a['impression_statistics'] ?? []) !== 1)
        throw new RuntimeException('Missing or ambiguous statistics');
    $out = ['date'=>$date,'accountId'=>'49275'];
    foreach (['period_spend_total','period_spend_from_ads','period_spend_other'] as $key) {
        $v = $a['expenses'][0][$key] ?? null;
        if ((!is_float($v) && !is_int($v)) || !is_finite((float)$v) || $v < 0 || $v > 1e9 || abs(round($v*100)-$v*100)>0.0001)
            throw new RuntimeException("Invalid $key");
        $out[$key.'Cents'] = (int)round($v*100);
    }
    foreach (['shows','views','contacts'] as $key) {
        $v = $a['impression_statistics'][0][$key] ?? null;
        if (!is_int($v) || $v < 0) throw new RuntimeException("Invalid $key");
        $out[$key] = $v;
    }
    return $out;
}

function b2b_fetch(string $date, string $token): array {
    $url = 'https://dev.b2b-help.ru/acc_manager/list?' . http_build_query(['date_from'=>$date,'date_to'=>$date]);
    $ch = curl_init($url);
    curl_setopt_array($ch,[CURLOPT_HTTPHEADER=>['Authorization: '.$token,'Accept: application/json'],
        CURLOPT_FOLLOWLOCATION=>false,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>45]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch,CURLINFO_RESPONSE_CODE);
    if (!is_string($body) || $status !== 200) throw new RuntimeException("B2BHelp HTTP $status");
    return b2b_day(json_decode($body,true,512,JSON_THROW_ON_ERROR),$date);
}

function b2b_store(PDO $pdo, array $day, array $cfg): void {
    $date = $day['date'];
    $actor = ['uid'=>'service-b2bhelp-49275','role'=>'owner'];
    $amount = $day[$cfg['expense_field'].'Cents'];
    $account = $cfg['ledger_account'];
    $id = 'b2bhelp-day:'.$date;
    $lock = 'finance:'.substr(hash('sha256',tg_workspace()),0,48);
    $statement = $pdo->prepare('SELECT GET_LOCK(?,10)');
    $statement->execute([$lock]);
    if ((int)$statement->fetchColumn() !== 1) throw new RuntimeException('Financial journal busy');
    try {
        $pdo->beginTransaction();
        $existing = fin_list($pdo,$actor);
        $matched = false;
        foreach ($existing as $r) {
            if (($r['periodFrom'] ?? $r['date']) > $date || ($r['periodTo'] ?? $r['date']) < $date) continue;
            if (($r['source'] ?? '') === 'avito' && ($r['account'] ?? '') === $account && ($r['externalId'] ?? '') === $id) {
                if (empty($r['active']) || $r['amountCents'] !== $amount || $r['kind'] !== 'expense') throw new RuntimeException('Existing daily expense differs or is void');
                $matched = true;
            } elseif (($r['active'] ?? true) && (($r['source'] ?? '') === 'avito' || preg_match('/реклам|авито|avito|b2bhelp/iu',($r['category'] ?? '').' '.($r['note'] ?? '')))) {
                throw new RuntimeException('Advertising journal overlap: reconcile existing entry');
            }
        }
        $writes = [];
        if ($amount && !$matched) {
            if (count($existing)>=20000) throw new RuntimeException('Expense capacity');
            $row = fin_normalize(['date'=>$date,'source'=>'avito','account'=>$account,'externalId'=>$id,'kind'=>'expense','category'=>'Реклама','amountCents'=>$amount,'note'=>'Дневной расход B2BHelp · Мастер Иван']);
            $key = fin_id($row);
            $writes[tg_path('financeExpenses',$key)] = $row + ['id'=>$key,'active'=>true,'createdAt'=>gmdate('c'),'updatedAt'=>gmdate('c'),'createdBy'=>$actor['uid'],'updatedBy'=>$actor['uid']];
        }
        $path = tg_path('financeMetrics','b2bhelp-49275-'.$date);
        if (tg_read($pdo,$path,true) != $day) $writes[$path] = $day;
        if (($cfg['sole_contact_source'] ?? false) === true) {
            $path = tg_path('financeMetrics','dailyContacts');
            $counts = tg_read($pdo,$path,true)['counts'] ?? [];
            if (isset($counts[$date]) && $counts[$date] !== $day['contacts']) throw new RuntimeException('Existing contact count differs');
            if (!isset($counts[$date])) { $counts[$date]=$day['contacts']; $writes[$path]=['counts'=>$counts]; }
        }
        if ($writes) tg_write_many($pdo,$writes,$actor['uid'],'owner','b2bhelp_daily_sync');
        $pdo->commit();
    } finally {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') !== __FILE__) return;
try {
    $path = realpath($argv[1] ?? '');
    if (!$path || !is_file($path)) throw new RuntimeException('Supply a private configuration path');
    $cfg = require $path;
    $_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__);
    $token = trim($cfg['token'] ?? '');
    if ($token === '' || preg_match('/[\r\n]/',$token) || empty($cfg['ledger_account']) || !in_array($cfg['expense_field'] ?? '', ['period_spend_from_ads','period_spend_total'],true))
        throw new RuntimeException('Incomplete integration configuration');
    $tz = new DateTimeZone('Europe/Moscow');
    $start = DateTimeImmutable::createFromFormat('!Y-m-d',$cfg['start_date'],$tz);
    if (!$start || $start->format('Y-m-d') !== $cfg['start_date']) throw new RuntimeException('Invalid start date');
    $end = new DateTimeImmutable('yesterday midnight',$tz);
    $pdo = tg_db();
    $failures = 0; $requests = 0;
    for ($dt=$start;$dt<=$end;$dt=$dt->modify('+1 day')) {
        $date=$dt->format('Y-m-d');
        if (tg_read($pdo,tg_path('financeMetrics','b2bhelp-49275-'.$date)) !== null) continue;
        if (++$requests > 31) break;
        try { b2b_store($pdo,b2b_fetch($date,$token),$cfg); echo "$date OK\n"; }
        catch (Throwable $e) { ++$failures; fwrite(STDERR,"$date ".$e->getMessage()."\n"); if (preg_match('/B2BHelp HTTP (0|401|403|429|5\d\d)/',$e->getMessage())) break; }
    }
    exit($failures ? 1 : 0);
} catch (Throwable $e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); }
