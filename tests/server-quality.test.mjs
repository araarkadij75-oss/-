import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../hosted-snapshot/crm-api/quality.php',import.meta.url));
const source=fs.readFileSync(path,'utf8');
test('HTTP monitor is owner authenticated and cannot execute the scanner',()=>{
 const http=source.slice(source.lastIndexOf("if(($_SERVER['REQUEST_METHOD']"));
 assert.match(http,/quality_owner\(tg_jwt_actor\(\$pdo\)\)/);
 assert.match(http,/quality_read\(quality_private_dir/);
 assert.doesNotMatch(http,/quality_run\(/);
 assert.match(source,/\['role'\].*'owner'.*empty\(\$actor\['uid'\]\)/);
});
test('scanner is bounded and only reads CRM documents',()=>{
 assert.match(source,/quality_load\(\$pdo,'orders',20000\)/);
 assert.match(source,/quality_load\(\$pdo,'shiftReports',10000\)/);
 assert.match(source,/count\(\$rows\)>\$limit/);
 assert.match(source,/SELECT document_id,data_json FROM crm_documents/);
 assert.doesNotMatch(source,/tg_write_many|INSERT INTO|UPDATE crm_|DELETE FROM/);
});
test('private atomic results, overlap lock, stale heartbeat and sanitized failures are explicit',()=>{
 assert.match(source,/LOCK_EX\|LOCK_NB/);assert.match(source,/chmod\(\$temp,0600\)/);
 assert.match(source,/rename\(\$temp,\$file\)/);assert.match(source,/\$dir === \$root/);
 assert.match(source,/str_starts_with\(\$dir, \$root/);
 assert.match(source,/time\(\)-\$stamp>900/);assert.doesNotMatch(source,/getMessage\(|getTrace/);
 assert.match(source,/array_merge\(\$previous,\['state'=>'error'/);
});
const php=process.env.PHP_BINARY||'php';
const available=spawnSync(php,['-v'],{encoding:'utf8'}).status===0;
test('PHP rules validate dates, empty versus zero cash, duplicate accounting and frozen recipients',{skip:!available},()=>{
 const code=`define('ELITESERVICE_QUALITY_LIBRARY',true);require ${JSON.stringify(path.replaceAll('\\','/'))};
 $o=['orderId'=>'A','_status'=>'Выполнен','dispatcher'=>'Сергей','callDate'=>'2026-10-01','closeDate'=>'2026-10-24','total'=>0,'parts'=>0,'masterAmount'=>0,'companyShare'=>0];
 $r=['id'=>'r','date'=>'2026-10-24','shift'=>'sergey','ownerConfirmed'=>true,'subjectMemberId'=>'s','paidOrderIds'=>['A']];
 $ok=quality_analyze([$o],[$r]);$o['companyShare']='';$empty=quality_analyze([$o],[]);$o['companyShare']=0;$r2=$r;$r2['id']='other';$r2['date']='2026-10-25';$r2['shift']='artem';
 $owner=$o;$owner['dispatcher']='';$owner['_createdBy']='owner';$owner['_createdByName']='Владелец';
 $dup=$o;$dup['orderId']='B';$dup['_duplicateOf']='A';$linkedReport=$r;$linkedReport['paidOrderIds']=['A','B'];$undated=$o;$undated['closeDate']='';
 $active=$o;$active['_status']='В работе';$active['visitDate']='2030-01-01';
 echo json_encode(['linked'=>quality_analyze([$o,$dup],[$linkedReport]),'badLink'=>quality_analyze([$dup],[]),'undated'=>quality_analyze([$undated],[$r]),'ok'=>$ok,'empty'=>$empty,'conflict'=>quality_analyze([$o],[$r,$r2]),'owner'=>quality_analyze([$owner],[]),'active'=>quality_analyze([$active],[]),'excel'=>quality_date(46326.75),'excelString'=>quality_date('46326'),'invalid'=>quality_date('31.02.2026'),'valid'=>quality_date('29.02.2024')],JSON_THROW_ON_ERROR);`;
 const run=spawnSync(php,['-r',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const result=JSON.parse(run.stdout);assert.equal(result.linked.counts.paid_linked_duplicate,1);assert.equal(result.badLink.counts.duplicate_link_invalid,1);assert.equal(result.undated.issues.find(x=>x.code==='closed_date').severity,'warning');assert.equal(result.ok.issueCount,0);assert.equal(result.empty.counts.closed_cash,1);
 assert.equal(result.conflict.counts.paid_duplicate,1);assert.equal(result.conflict.counts.paid_owner_conflict,1);
 assert.equal(result.owner.counts.closed_dispatcher,1);assert.equal(result.active.counts.active_required,1);assert.equal(result.active.counts.active_master,1);assert.equal(result.active.counts.invalid_visitDate,undefined);
 assert.equal(result.invalid,'');assert.equal(result.valid,'2024-02-29');
 assert.equal(result.excel,new Date(Date.UTC(1899,11,30)+46326*86400000).toISOString().slice(0,10));assert.equal(result.excelString,'');
});
