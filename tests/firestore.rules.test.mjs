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
      ['owner-uid', {role:'owner', active:true, login:'owner'}],
      ['dispatch-uid', {id:'sergey', name:'Сергей', shift:'sergey', role:'dispatcher', active:true, login:'sergey'}],
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

test('Google bridge config is owner-only', async () => {
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'config','google')));
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','google')));
  await assertFails(getDoc(doc(dbFor('master-uid'),'workspaces',ws,'config','google')));
});

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
});

test('dispatcher-logistic closes only own shift with server-calculated salary', async () => {
  const db=dbFor('ops-uid');
  const ref=doc(db,'workspaces',ws,'shiftReports','2026-09-23-artem-artem');
  const valid={id:'2026-09-23-artem-artem',date:'2026-09-23',closedBy:'artem',closedByName:'Артём',shift:'artem',cash:50000,salary:5000,orders:8,serverClosedAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,valid));
  await assertFails(setDoc(doc(db,'workspaces',ws,'shiftReports','wrong-pay'),{...valid,id:'wrong-pay',salary:2000,serverClosedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{salary:9000}));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftReports','2026-09-23-artem-artem')));
});

test('dispatcher cannot close a shift report', async () => {
  await assertFails(setDoc(doc(dbFor('dispatch-uid'),'workspaces',ws,'shiftReports','forged'),{id:'forged',date:'2026-09-23',closedBy:'sergey',closedByName:'Сергей',shift:'sergey',cash:1000,salary:2000,orders:1,serverClosedAt:serverTimestamp()}));
});
