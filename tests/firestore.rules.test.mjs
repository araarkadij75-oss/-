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
      ['dispatch-uid', {role:'dispatcher', active:true, login:'dispatch'}],
      ['ops-uid', {role:'dispatcher_logistic', active:true, login:'ops'}],
      ['logistic-uid', {role:'logistic', active:true, login:'logistic'}],
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
    _status:'В работе', _updatedAt:new Date().toISOString()
  }));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {master:'Иван'}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {total:5000}));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE')));
});

test('dispatcher-logistic can operate but cannot canonical-delete', async () => {
  const db=dbFor('ops-uid');
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {master:'Иван', total:11000}));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
});

test('logistic cannot create or delete canonical order', async () => {
  const db=dbFor('logistic-uid');
  await assertFails(setDoc(doc(db,'workspaces',ws,'orders','TEST-LOG-CREATE'), {orderId:'TEST-LOG-CREATE'}));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {total:12000}));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
});

test('master reads only own assignment and own canonical order', async () => {
  const db=dbFor('master-uid');
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OWN')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OTHER')));
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
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
