<?php
declare(strict_types=1);
require __DIR__.'/../hosted-snapshot/crm-api/b2b-sync.php';

// Run against an isolated MySQL database created for this test alone.
$pdo = new PDO(getenv('B2B_TEST_DSN'), 'root', getenv('B2B_TEST_PASSWORD'), [
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC
]);
if ($pdo->query('SELECT DATABASE()')->fetchColumn() !== 'b2b_sync_test') throw new RuntimeException('Expected test database');
$pdo->exec('CREATE TEMPORARY TABLE crm_documents(workspace_id varchar(100),collection_path varchar(200),document_id varchar(128),data_json JSON,revision int,PRIMARY KEY(workspace_id,collection_path,document_id))');
$pdo->exec('CREATE TEMPORARY TABLE crm_events(workspace_id varchar(100),revision int,actor_uid varchar(100),actor_role varchar(40),event_type varchar(80),collection_path varchar(200),document_id varchar(128))');
$pdo->exec('CREATE TEMPORARY TABLE crm_collection_revisions(workspace_id varchar(100),collection_path varchar(200),revision int,PRIMARY KEY(workspace_id,collection_path))');
$private = sys_get_temp_dir().'/b2b-test-'.bin2hex(random_bytes(8));
mkdir($private,0700); mkdir($private.'/public');
$_SERVER['DOCUMENT_ROOT']=$private.'/public';
file_put_contents($private.'/eliteservice-config.php',"<?php return ['db'=>[]];");
file_put_contents($private.'/eliteservice-runtime.php',"<?php return ['workspace_id'=>'test'];");
putenv('ELITESERVICE_CONFIG='.$private.'/eliteservice-config.php');
register_shutdown_function(static function () use ($private) {
    unlink($private.'/eliteservice-config.php'); unlink($private.'/eliteservice-runtime.php'); rmdir($private.'/public'); rmdir($private);
});
function check_sync(bool $condition): void { if (!$condition) throw new RuntimeException('Unexpected sync result'); }
$date='2026-11-25';
$account=['platform_account_id'=>49275,'avito_user_id'=>'135807984','is_active'=>true,'period'=>['from'=>$date,'to'=>$date],
    'expenses'=>[['period_spend_total'=>17596.83,'period_spend_from_ads'=>17000,'period_spend_other'=>596.83]],
    'impression_statistics'=>[['shows'=>120,'views'=>30,'contacts'=>8]]];
$day=b2b_day(['status'=>true,'result'=>['accounts'=>[$account]]],$date);
$cfg=['ledger_account'=>'test account','expense_field'=>'period_spend_total','sole_contact_source'=>true];
b2b_store($pdo,$day,$cfg);
b2b_store($pdo,$day,$cfg);
$actor=['role'=>'owner','uid'=>'test'];
$rows=fin_list($pdo,$actor);
check_sync(count($rows)===1 && $rows[0]['amountCents']===1759683);
check_sync(tg_read($pdo,tg_path('financeMetrics','dailyContacts'))['counts'][$date]===8);
check_sync((int)$pdo->query('SELECT COUNT(*) FROM crm_events')->fetchColumn()===3);
$conflict=$day; $conflict['period_spend_totalCents']++;
try { b2b_store($pdo,$conflict,$cfg); throw new LogicException('Conflict accepted'); }
catch (RuntimeException $e) { check_sync(str_contains($e->getMessage(),'differs')); }
check_sync(fin_list($pdo,$actor)[0]['amountCents']===1759683);
$zero=$day; $zero['date']='2026-11-26'; $zero['period_spend_totalCents']=0;
b2b_store($pdo,$zero,$cfg);
check_sync(count(fin_list($pdo,$actor))===1);
echo "Daily expense, contacts, retry, conflict rollback and zero verified\n";
