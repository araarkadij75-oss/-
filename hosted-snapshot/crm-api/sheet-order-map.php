<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(405);
    exit;
}

// Лист1 of "Текущие заказы ВСЕ". Positions include the blank, status-coloured A column.
function sheet_order_text($v): string {
    if (!is_scalar($v) && $v !== null) throw new UnexpectedValueException('Некорректное поле заказа.');
    return trim((string)$v);
}

function sheet_order_same($a, $b): bool {
    $normal = static function($s) {
        return preg_replace('/\s+/u', ' ', str_replace(['ё','Ё'], ['е','Е'], sheet_order_text($s)));
    };
    return preg_match('~^'.preg_quote($normal($a), '~').'$~iuD', $normal($b)) === 1;
}

function sheet_order_header(array $header): void {
    $expect = ['', 'нпр', 'Город', 'Дата Звонка', 'Время звонка', 'Дата выезда', 'Время выезд',
        'Имя', 'Конт. номер', 'Адрес', 'Запрос', 'Мастер', 'ЗП', 'Дисп', 'ПП', 'З/Ч',
        'Чистый чек', 'Общая сумма', 'Процент мастера', 'Сдача', 'отзыв', 'Дата сдачи заявки', 'ком'];
    foreach ($expect as $i=>$title) {
        if (!sheet_order_same($header[$i] ?? '', $title)) throw new UnexpectedValueException('Изменились заголовки исходной таблицы.');
    }
}

function sheet_order_day($v): string {
    $s = sheet_order_text($v);
    if (is_numeric($v) && (float)$v === (float)(int)$v && (int)$v>20000 && (int)$v<100000) {
        return gmdate('Y-m-d', ((int)$v - 25569)*86400);
    }
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $s, $m)) {
        [$y,$mo,$d] = [(int)$m[1],(int)$m[2],(int)$m[3]];
    } elseif (preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/D', $s, $m)) {
        [$d,$mo,$y] = [(int)$m[1],(int)$m[2],(int)$m[3]];
    } else return '';
    return checkdate($mo,$d,$y) ? sprintf('%04d-%02d-%02d',$y,$mo,$d) : '';
}

function sheet_order_phone($v): string {
    $p = preg_replace('/\D/', '', sheet_order_text($v));
    if (strlen($p)===11 && ($p[0]==='8' || $p[0]==='7')) return '+7'.substr($p,1);
    return strlen($p)===10 ? '+7'.$p : $p;
}

function sheet_order_find(array $order, array $rows): ?int {
    sheet_order_header($rows[0] ?? []);
    $day = sheet_order_day($order['callDate'] ?? '');
    if ($day==='') throw new UnexpectedValueException('Проверьте дату звонка.');
    $phone = sheet_order_phone($order['phone'] ?? '');
    $matches=[]; $possible=false;
    $sourceRow=(int)($order['_sourceRow'] ?? 0);
    foreach ($rows as $i=>$r) {
        if (!$i || sheet_order_day($r[3] ?? '')!==$day) continue;
        $samePhone=$phone!=='' && $phone===sheet_order_phone($r[8] ?? '');
        $name=sheet_order_text($r[7] ?? '')!=='' && sheet_order_same($r[7],$order['name'] ?? '');
        $address=sheet_order_text($r[9] ?? '')!=='' && sheet_order_same($r[9],$order['address'] ?? '');
        $request=sheet_order_text($r[10] ?? '')!=='' && sheet_order_same($r[10],$order['request'] ?? '');
        if (($samePhone && ($address || $request)) || ($name && $address && $request)) $matches[]=$i+1;
        elseif ($samePhone || ($name && $address) || ($request && $address)) $possible=true;
    }
    if (count($matches)===1 && !$possible) return $matches[0];
    if ($matches || $possible || $sourceRow>1) throw new UnexpectedValueException('Нужна сверка с существующей строкой заказа.');
    return null;
}

function sheet_order_template_index(array $rows): int {
    $lastOrder=0;
    foreach ($rows as $i=>$r) {
        if (!$i) continue;
        foreach ($r as $col=>$v) {
            if (in_array($col,[1,2,16,18,19],true) || sheet_order_text($v)==='') continue;
            $lastOrder=$i;
            break;
        }
    }
    for ($i=$lastOrder+1;$i<count($rows);$i++) {
        $r=$rows[$i];
        if (!sheet_order_same($r[1]??'', 'ПК') || !sheet_order_same($r[2]??'', 'СПБ')) continue;
        foreach ([16,18,19] as $n) {
            $v=$r[$n]??null;
            if (!is_numeric($v) || (float)$v!=0) continue 2;
        }
        return $i;
    }
    throw new UnexpectedValueException('Нет свободной строки с шаблоном заказа.');
}

function sheet_order_master(string $master, array $rows): string {
    if ($master==='') return '';
    $terms=preg_split('/\s+/u',$master,-1,PREG_SPLIT_NO_EMPTY);
    $options=[$master];
    if (count($terms)===2) {
        foreach ([$terms,array_reverse($terms)] as [$surname,$given]) {
            if (preg_match('/^\p{L}/u',$given,$m)) $options[]=$surname.' '.$m[0].'.';
        }
    }
    $found=[];
    foreach ($rows as $i=>$r) {
        $name=sheet_order_text($r[11]??'');
        if ($i && $name!=='') foreach ($options as $idx=>$option) {
            if (sheet_order_same($name,$option)) {
                // Prefer a current abbreviation to old full names from hand-entered rows.
                $found[$idx?1:0]=$name;
                break;
            }
        }
    }
    return $found[1] ?? $found[0] ?? $master;
}

function sheet_order_amount($v): ?float {
    if ($v===null || $v==='') return null;
    $s=str_replace(',', '.',preg_replace('/[\s\x{00a0}]+/u','',sheet_order_text($v)));
    if (!is_numeric($s) || !is_finite((float)$s)) throw new UnexpectedValueException('Некорректная сумма в заказе.');
    return round((float)$s,2);
}

function sheet_order_cells(array $order,array $rows): array {
    $cells=[];
    $put=static function(int $col,$value) use (&$cells): void {
        if ($value===null || $value==='') return;
        $type=is_int($value)||is_float($value)?'numberValue':'stringValue';
        $cells[$col]=['userEnteredValue'=>[$type=>$value]];
    };
    foreach ([1=>'direction',2=>'city',4=>'callTime',6=>'visitTime',7=>'name',8=>'phone',9=>'address',10=>'request',
              12=>'_sourceSalaryScheme',13=>'dispatcher',22=>'_sourceComment'] as $col=>$key) {
        $put($col,sheet_order_text($order[$key]??''));
    }
    $put(11,sheet_order_master(sheet_order_text($order['master']??''),$rows));
    foreach ([3=>'callDate',5=>'visitDate',21=>'closeDate'] as $col=>$key) {
        $raw=sheet_order_text($order[$key]??'');
        if ($raw==='') continue;
        $day=sheet_order_day($raw);
        if ($day==='') throw new UnexpectedValueException('Проверьте даты заказа.');
        $ts=strtotime($day.' UTC');
        // D/F are DATE cells; V is configured as TEXT, with full-year precision.
        $put($col,$col===21?gmdate('d.m.Y',$ts):intdiv($ts,86400)+25569);
    }
    $review=sheet_order_text($order['review']??'');
    $positive=is_numeric($review) && (float)$review!=0;
    foreach (['да','yes','true','+','есть','хороший','хорошо','получен','получили'] as $s) $positive=$positive || sheet_order_same($review,$s);
    if ($review!=='') $put(20,$positive?1:0);
    $amounts=[];
    foreach ([14=>'pp',15=>'parts',16=>'cleanCheck',17=>'total',18=>'masterAmount',19=>'companyShare'] as $col=>$key) {
        $amounts[$col]=sheet_order_amount($order[$key]??null);
    }
    foreach ([14,15,17] as $col) $put($col,$amounts[$col]);
    // Retain live Q/S/T formulas when they reproduce the CRM's amounts. A custom
    // split or capped review bonus can differ from the worksheet's default formula.
    $base=($amounts[17]??0)-($amounts[15]??0);
    $company=$base*(($base<4000?.7:($base<8000?.6:.5))-($positive?.05:0));
    $master=$base-($amounts[19]??$company);
    foreach ([16=>$base,18=>$master,19=>$company] as $col=>$computed) {
        if ($amounts[$col]!==null && abs($computed-$amounts[$col])>0.000001) $put($col,$amounts[$col]);
    }
    if (!empty($order['_cashReceipts'])) {
        $items=[];
        foreach ($order['_cashReceipts'] as $e) {
            $day=sheet_order_day($e['date']??'');
            if (!$day || !is_int($e['cents']??null) || $e['cents']<=0) throw new UnexpectedValueException('Проверьте сдачу частями.');
            $items[]=implode('.', array_reverse(explode('-',$day))).' — '.number_format($e['cents']/100,2,',',' ').' ₽';
        }
        $put(22, trim(sheet_order_text($order['_sourceComment']??'')."\nСдача частями: ".implode(', ',$items)));
    }
    ksort($cells);
    return $cells;
}

function sheet_order_readback(array $cells,array $actual): bool {
    foreach ($cells as $col=>$cell) {
        $v=$cell['userEnteredValue'];
        if (isset($v['numberValue'])) {
            if (!is_numeric($actual[$col]??null) || abs((float)$actual[$col]-$v['numberValue'])>0.000001) return false;
        } elseif (($actual[$col]??null)!==$v['stringValue']) return false;
    }
    return true;
}

function sheet_order_color(string $status): ?array {
    $colors=['Выполнен'=>'00FF00','В работе'=>'FFFF00','Забор / техника у мастера'=>'4285F4',
             'Будущая дата'=>'B7B7B7','Отказ'=>'FF0000','Отмена'=>'FF9900'];
    if (!isset($colors[$status])) return null;
    $hex=$colors[$status];
    return ['red'=>hexdec(substr($hex,0,2))/255,'green'=>hexdec(substr($hex,2,2))/255,'blue'=>hexdec(substr($hex,4,2))/255];
}
