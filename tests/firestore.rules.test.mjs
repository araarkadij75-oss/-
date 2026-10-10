import test, { before, after } from 'node:test';
import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';

const projectId = 'demo-master-ai';
const ws = 'master-ai-beta';
let env;

const dbFor = uid => env.authenticatedContext(uid).firestore();
const anonDb = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') }
  });

  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const members = [
      ['owner-uid', {role:'owner', active:true, login:'owner', name:'Владелец'}],
      ['dispatch-uid', {id:'sergey', name:'Сергей', shift:'sergey', role:'dispatcher', active:true, login:'sergey'}],
      ['sergey-ops-uid', {id:'sergey', name:'Сергей', shift:'sergey', role:'dispatcher_logistic', active:true, login:'sergey-ops'}],
      ['backup-ops-uid', {id:'backup', name:'Запасной', shift:'artem', role:'dispatcher_logistic', active:true, login:'backup'}],
      ['ops-uid', {id:'artem', name:'Артём', shift:'artem', role:'dispatcher_logistic', active:true, login:'artem'}],
      ['logistic-uid', {id:'logistic', name:'Логист', shift:'sergey', role:'logistic', active:true, login:'logistic'}],
      ['master-uid', {role:'master', active:true, login:'master', master:'Иван'}],
      ['master2-uid', {role:'master', active:true, login:'master2', master:'Петр'}],
      ['inactive-uid', {role:'dispatcher_logistic', active:false, login:'inactive'}]
    ];
    for (const [uid, data] of members) {
      await setDoc(doc(db, 'workspaces', ws, 'members', uid), data);
    }

    await setDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
      orderId:'TEST-OWN', name:'Клиент', phone:'79990000000', master:'Иван',
      total:10000, _masterStage:'assigned', _updatedAt:new Date().toISOString()
    });
    await setDoc(doc(db,'workspaces',ws,'orders','TEST-OTHER'), {
      orderId:'TEST-OTHER', name:'Другой', phone:'79990000001', master:'Петр',
      total:9000, _masterStage:'assigned', _updatedAt:new Date().toISOString()
    });
    await setDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OWN'), {
      orderId:'TEST-OWN', masterUid:'master-uid', name:'Клиент', _masterStage:'assigned'
    });
    await setDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OTHER'), {
      orderId:'TEST-OTHER', masterUid:'master2-uid', name:'Другой', _masterStage:'assigned'
    });
    await setDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-OWN'), {
      orderId:'TEST-OWN', name:'Клиент', phone:'79990000000'
    });
    await setDoc(doc(db,'workspaces',ws,'masterPhones','TEST-OWN'), {
      orderId:'TEST-OWN', phone:'79990000000', masterUid:'master-uid',
      unlockAt:Timestamp.fromMillis(Date.now()+3600000), earlyAccess:false
    });
    await setDoc(doc(db,'workspaces',ws,'masterPhones','TEST-PAST'), {
      orderId:'TEST-PAST', phone:'79990000002', masterUid:'master-uid',
      unlockAt:Timestamp.fromMillis(Date.now()-3600000), earlyAccess:false
    });
    await setDoc(doc(db,'workspaces',ws,'masterPhones','TEST-EARLY'), {
      orderId:'TEST-EARLY', phone:'79990000003', masterUid:'master-uid',
      unlockAt:Timestamp.fromMillis(Date.now()+3600000), earlyAccess:true
    });
    await setDoc(doc(db,'workspaces',ws,'config','public'), {phoneEveningTime:'18:00'});
    await setDoc(doc(db,'workspaces',ws,'config','ui'), {theme:{density:'compact'}});
    await setDoc(doc(db,'workspaces',ws,'config','google'), {sheetUrl:'test'});
    await setDoc(doc(db,'workspaces',ws,'config','payroll'), {shiftBasePay:2000,shiftCashThreshold:20000,shiftCashRate:10});
  });
});

after(async () => {
  await env?.cleanup();
});

test('anonymous cannot read canonical orders', async () => {
  await assertFails(getDoc(doc(anonDb(),'workspaces',ws,'orders','TEST-OWN')));
});

test('inactive member cannot read canonical orders', async () => {
  await assertFails(getDoc(doc(dbFor('inactive-uid'),'workspaces',ws,'orders','TEST-OWN')));
});

test('owner has canonical CRUD', async () => {
  const db=dbFor('owner-uid');
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
  await assertSucceeds(setDoc(doc(db,'workspaces',ws,'orders','TEST-OWNER-CREATE'), {orderId:'TEST-OWNER-CREATE', total:1}));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWNER-CREATE'), {total:2}));
  await assertSucceeds(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWNER-CREATE')));
});

test('dispatcher can create intake fields but cannot assign master or edit money', async () => {
  const db=dbFor('dispatch-uid');
  await assertSucceeds(setDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {
    orderId:'TEST-DISPATCH-CREATE', name:'Новый', phone:'70000000000', request:'Диагностика',
    dispatcher:'Сергей', _createdBy:'sergey', _createdByName:'Сергей', _createdByShift:'sergey',
    _updatedBy:'sergey', _updatedByName:'Сергей', _updatedByShift:'sergey',
    _status:'В работе', _updatedAt:new Date().toISOString()
  }));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {master:'Иван'}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {total:5000}));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE')));
  const actor={_updatedBy:'sergey',_updatedByName:'Сергей',_updatedByShift:'sergey'};
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {dispatcher:'Артём',...actor}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {_createdBy:'artem',...actor}));
});

test('dispatcher-logistic can operate but cannot canonical-delete', async () => {
  const db=dbFor('ops-uid');
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
    master:'Иван', total:11000, _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertSucceeds(setDoc(doc(db,'workspaces',ws,'orders','TEST-OPS-CREATE'), {
    orderId:'TEST-OPS-CREATE', dispatcher:'Артём',
    _createdBy:'artem', _createdByName:'Артём', _createdByShift:'artem',
    _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OPS-CREATE'), {
    _createdByName:'Сергей', _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
});

test('Sergey and Artem dispatcher-logistics share one workspace order queue across shifts', async () => {
  const sergey = dbFor('sergey-ops-uid');
  const artem = dbFor('ops-uid');
  const canonical = doc(sergey, 'workspaces', ws, 'orders', 'TEST-OWN');
  const safeMirror = doc(sergey, 'workspaces', ws, 'dispatcherOrders', 'TEST-OWN');

  // Both shift profiles read the same canonical order and its role-safe mirror.
  await assertSucceeds(getDoc(canonical));
  await assertSucceeds(getDoc(doc(artem, 'workspaces', ws, 'orders', 'TEST-OWN')));
  await assertSucceeds(getDoc(safeMirror));
  await assertSucceeds(getDoc(doc(artem, 'workspaces', ws, 'dispatcherOrders', 'TEST-OWN')));
  await assertSucceeds(getDocs(collection(sergey, 'workspaces', ws, 'orders')));
  await assertSucceeds(getDocs(collection(artem, 'workspaces', ws, 'orders')));
});

test('dispatcher profiles see cross-shift shared queue without canonical financial access', async () => {
  const dispatcher = dbFor('dispatch-uid');
  await assertSucceeds(getDoc(doc(dispatcher, 'workspaces', ws, 'dispatcherOrders', 'TEST-OWN')));
  await assertSucceeds(getDocs(collection(dispatcher, 'workspaces', ws, 'dispatcherOrders')));
  await assertFails(getDoc(doc(dispatcher, 'workspaces', ws, 'orders', 'TEST-OWN')));
  await assertFails(getDocs(collection(dispatcher, 'workspaces', ws, 'orders')));
});

test('logistic cannot create or delete canonical order', async () => {
  const db=dbFor('logistic-uid');
  await assertFails(setDoc(doc(db,'workspaces',ws,'orders','TEST-LOG-CREATE'), {orderId:'TEST-LOG-CREATE'}));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
    total:12000, _updatedBy:'logistic', _updatedByName:'Логист', _updatedByShift:'sergey'
  }));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
});

test('master reads only own sanitized assignment and no canonical order', async () => {
  const db=dbFor('master-uid');
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OWN')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OTHER')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'orders','TEST-OTHER')));
});

test('master assignment query must be constrained to own uid', async () => {
  const db=dbFor('master-uid');
  const own=query(collection(db,'workspaces',ws,'masterAssignments'),where('masterUid','==','master-uid'));
  await assertSucceeds(getDocs(own));
  await assertFails(getDocs(collection(db,'workspaces',ws,'masterAssignments')));
});

test('master can update workflow fields but not money/client identity', async () => {
  const db=dbFor('master-uid');
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
    _masterStage:'accepted', _acceptedAt:new Date().toISOString(), _updatedAt:new Date().toISOString()
  }));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {total:1}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {phone:'70000000001'}));
});

test('master cannot skip workflow stages or close an order directly', async () => {
  const db=dbFor('master2-uid');
  const ref=doc(db,'workspaces',ws,'orders','TEST-OTHER');
  await assertFails(updateDoc(ref, {_masterStage:'done', _status:'Выполнен', _doneAt:new Date().toISOString(), _updatedAt:new Date().toISOString()}));
  await assertFails(updateDoc(ref, {_masterStage:'review_pending', _status:'На проверке', _requiresCloseApproval:false, closeDate:'24.09.2026', _updatedAt:new Date().toISOString()}));
  await assertFails(updateDoc(ref, {closeDate:'24.09.2026'}));
});

test('phone is server-time gated for master', async () => {
  const db=dbFor('master-uid');
  await assertFails(getDoc(doc(db,'workspaces',ws,'masterPhones','TEST-OWN')));
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'masterPhones','TEST-PAST')));
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'masterPhones','TEST-EARLY')));
});

test('other master cannot read phone', async () => {
  await assertFails(getDoc(doc(dbFor('master2-uid'),'workspaces',ws,'masterPhones','TEST-PAST')));
});

test('Google settings stay owner-only; non-owner connector access is denied',async()=>{const owner=doc(dbFor('owner-uid'),'workspaces',ws,'config','google');await assertSucceeds(getDoc(owner));await assertSucceeds(setDoc(owner,{bridgeUrl:'',bridgeUrlV2:'',sheetUrl:'',secret:''},{merge:true}));for(const uid of ['ops-uid','dispatch-uid','logistic-uid','master-uid']){const ref=doc(dbFor(uid),'workspaces',ws,'config','google');await assertFails(getDoc(ref));await assertFails(setDoc(ref,{secret:'x'}));await assertFails(updateDoc(ref,{secret:'x'}))}});
test('UI config is readable by active users but writable only by owner', async () => {
  await assertSucceeds(getDoc(doc(dbFor('master-uid'),'workspaces',ws,'config','ui')));
  await assertFails(updateDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','ui'), {'theme.density':'spacious'}));
  await assertSucceeds(updateDoc(doc(dbFor('owner-uid'),'workspaces',ws,'config','ui'), {'theme.density':'spacious'}));
});

test('payroll settings are owner-only', async () => {
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','payroll')));
  await assertFails(getDoc(doc(dbFor('master-uid'),'workspaces',ws,'config','payroll')));
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'config','payroll')));
  await assertFails(updateDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','payroll'), {shiftBasePay:9000}));
  await assertSucceeds(updateDoc(doc(dbFor('owner-uid'),'workspaces',ws,'config','payroll'), {shiftBasePay:2000}));
  await assertSucceeds(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'config','payrollPolicy'), {shiftBasePay:2400,shiftCashThreshold:30000,shiftCashRate:12}));
  await assertSucceeds(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','payrollPolicy')));
  await assertFails(getDoc(doc(dbFor('master-uid'),'workspaces',ws,'config','payrollPolicy')));
  await assertFails(getDoc(doc(dbFor('dispatch-uid'),'workspaces',ws,'config','payrollPolicy')));
  await assertFails(updateDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','payrollPolicy'), {shiftBasePay:1}));
});

test('shift reports are private per staff member and use one deterministic daily id', async () => {
  const db=dbFor('ops-uid');
  const ref=doc(db,'workspaces',ws,'shiftReports','2026-09-23-artem');
  const valid={id:'2026-09-23-artem',date:'2026-09-23',closedBy:'artem',closedByName:'Артём',shift:'artem',shiftName:'Смена Артёма',orders:8,financialOrders:4,completed:3,active:2,refused:1,cancelled:0,unassigned:0,reviewPending:0,reviews:2,reviewRate:66.7,turnover:60000,cash:50000,avgCheck:15000,salary:5000,basePay:2000,cashThreshold:20000,cashRate:10,orderIds:['a','b'],dataHash:'hash',closedAt:new Date().toISOString(),serverClosedAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,valid));
  await assertFails(setDoc(doc(dbFor('backup-ops-uid'),'workspaces',ws,'shiftReports',valid.id),{...valid,closedBy:'backup',closedByName:'Запасной',serverClosedAt:serverTimestamp()}));
  const sergeyDb=dbFor('sergey-ops-uid');
  const sergey={...valid,id:'2026-09-23-sergey',closedBy:'sergey',closedByName:'Сергей',shift:'sergey',shiftName:'Смена Сергея',cash:1000,salary:2000,turnover:5000,avgCheck:5000,serverClosedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(sergeyDb,'workspaces',ws,'shiftReports',sergey.id),sergey));
  await assertFails(setDoc(ref,{...valid,serverClosedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,'workspaces',ws,'shiftReports','2026-09-23-artem-copy'),{...valid,id:'2026-09-23-artem-copy',serverClosedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,'workspaces',ws,'shiftReports','wrong-pay'),{...valid,id:'wrong-pay',salary:2000,serverClosedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,'workspaces',ws,'shiftReports','2026-09-24-artem-artem'),{...valid,id:'2026-09-24-artem-artem',date:'2026-09-24',unexpected:'field',serverClosedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{salary:9000}));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(dbFor('dispatch-uid'),'workspaces',ws,'shiftReports','2026-09-23-artem')));
  await assertFails(getDocs(collection(dbFor('dispatch-uid'),'workspaces',ws,'shiftReports')));
  await assertSucceeds(getDocs(query(collection(dbFor('ops-uid'),'workspaces',ws,'shiftReports'),where('closedBy','==','artem'))));
  await assertFails(getDocs(query(collection(dbFor('ops-uid'),'workspaces',ws,'shiftReports'),where('closedBy','==','sergey'))));
  await assertFails(getDoc(doc(sergeyDb,'workspaces',ws,'shiftReports',valid.id)));
  await assertFails(getDocs(collection(sergeyDb,'workspaces',ws,'shiftReports')));
  await assertSucceeds(getDocs(query(collection(sergeyDb,'workspaces',ws,'shiftReports'),where('closedBy','==','sergey'))));
  await assertFails(getDocs(query(collection(sergeyDb,'workspaces',ws,'shiftReports'),where('closedBy','==','artem'))));
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftReports','2026-09-23-artem')));
  await assertSucceeds(getDocs(collection(dbFor('owner-uid'),'workspaces',ws,'shiftReports')));
});

test('weekly shift reports are owner-only', async () => {
  const report={id:'2026-09-21',start:'2026-09-21',end:'2026-09-27',closedBy:'owner-uid',closedByName:'Владелец',closedAt:new Date().toISOString(),closedShifts:1,expectedShifts:14,missingShifts:13,partial:true,orders:2,turnover:5000,cash:3000,salary:5000,avgCheck:2500,financialOrders:2,completed:2,reviews:1,reviewRate:50,sourceHash:'test-hash',dailyReports:[{id:'r1'}],duplicateOrders:0,serverClosedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'weeklyShiftReports','2026-09-21'),report));
  await assertFails(updateDoc(doc(dbFor('ops-uid'),'workspaces',ws,'weeklyShiftReports','2026-09-21'),{salary:0}));
  await assertSucceeds(updateDoc(doc(dbFor('owner-uid'),'workspaces',ws,'weeklyShiftReports','2026-09-21'),{closedAt:new Date().toISOString(),serverClosedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(dbFor('owner-uid'),'workspaces',ws,'weeklyShiftReports','2026-09-21')));
  await assertFails(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'weeklyShiftReports','2026-09-28'),{...report,id:'2026-09-28',start:'2026-09-28',duplicateOrders:2,serverClosedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'weeklyShiftReports','2026-09-21')));
  await assertFails(getDocs(collection(dbFor('ops-uid'),'workspaces',ws,'weeklyShiftReports')));
  await assertSucceeds(getDocs(collection(dbFor('owner-uid'),'workspaces',ws,'weeklyShiftReports')));
});

test('dispatcher cannot close a shift report', async () => {
  await assertFails(setDoc(doc(dbFor('dispatch-uid'),'workspaces',ws,'shiftReports','forged'),{id:'forged',date:'2026-09-23',closedBy:'sergey',closedByName:'Сергей',shift:'sergey',cash:1000,salary:2000,orders:1,serverClosedAt:serverTimestamp()}));
});

test('B2BHelp lead collection is denied for every role',async()=>{for(const uid of ['owner-uid','ops-uid','dispatch-uid','logistic-uid','master-uid','inactive-uid']){const db=dbFor(uid),ref=doc(db,'workspaces',ws,'b2bLeads','legacy');await assertFails(getDoc(ref));await assertFails(setDoc(ref,{provider:'b2bhelp'}));await assertFails(deleteDoc(ref))}await assertFails(getDoc(doc(anonDb(),'workspaces',ws,'b2bLeads','legacy')))});

test('legacy Avito leads collection has no access for any role', async () => {
  const owner = dbFor('owner-uid');
  await assertFails(getDoc(doc(owner,'workspaces',ws,'avitoLeads','legacy')));
  await assertFails(setDoc(doc(owner,'workspaces',ws,'avitoLeads','legacy'), {name:'Legacy'}));
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'avitoLeads','legacy')));
});
