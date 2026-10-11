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
  writeBatch,
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
    await setDoc(doc(db,'workspaces',ws,'orders','TEST-CLOSED'), {
      orderId:'TEST-CLOSED', name:'Закрытый заказ', master:'Иван', total:12000,
      parts:1000, cleanCheck:11000, masterAmount:5000, companyShare:6000,
      _status:'Выполнен', _cashClosedAt:new Date().toISOString(),
      _masterStage:'approved', _updatedAt:new Date().toISOString()
    });
    for (const [id,master] of [['TEST-CLOSE-SERGEY','Иван'],['TEST-CLOSE-ARTEM','Иван'],['TEST-CLOSE-LOGISTIC','Иван']]) {
      await setDoc(doc(db,'workspaces',ws,'orders',id), {orderId:id,master,total:1000,_status:'В работе'});
    }
    await setDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OWN'), {
      orderId:'TEST-OWN', masterUid:'master-uid', name:'Клиент', _masterStage:'assigned'
    });
    await setDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OTHER'), {
      orderId:'TEST-OTHER', masterUid:'master2-uid', name:'Другой', _masterStage:'assigned'
    });
    await setDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-CLOSED'), {
      orderId:'TEST-CLOSED', masterUid:'master-uid', name:'Закрытый заказ',
      _status:'Выполнен', _masterStage:'approved'
    });
    await setDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-OWN'), {
      orderId:'TEST-OWN', name:'Клиент', phone:'79990000000'
    });
    await setDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-CLOSED'), {
      orderId:'TEST-CLOSED', name:'Закрытый заказ', _status:'Выполнен',
      _masterStage:'approved'
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
  const xssId='<img src=x onerror=alert(1)>';
  await assertFails(setDoc(doc(db,'workspaces',ws,'orders',xssId), {
    orderId:xssId, name:'Проверка', dispatcher:'Сергей',
    _createdBy:'sergey', _createdByName:'Сергей', _createdByShift:'sergey',
    _updatedBy:'sergey', _updatedByName:'Сергей', _updatedByShift:'sergey'
  }));
  const actor={_updatedBy:'sergey',_updatedByName:'Сергей',_updatedByShift:'sergey'};
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {dispatcher:'Артём',...actor}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-DISPATCH-CREATE'), {_createdBy:'artem',...actor}));
});

test('dispatcher-logistic can edit a terminal order until its day is reported, but cannot edit a reported order', async () => {
  const db=dbFor('ops-uid');
  await assertFails(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
  await assertFails(getDocs(collection(db,'workspaces',ws,'orders')));
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-OWN')));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
    master:'Иван', _status:'В работе', _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
    total:12000, parts:2000, cleanCheck:10000, masterAmount:5000, companyShare:5000,
    _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  for (const field of ['_fixedMaster','_autoFinance']) {
    await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
      [field]:true,
      _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
    }));
  }
  for (const field of ['total','masterAmount','companyShare','_status','closeDate','master']) {
    await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-CLOSED'), {
      [field]:field==='_status'?'В работе':field==='master'?'Петр':999999,
      _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
    }));
  }
  await assertSucceeds(updateDoc(doc(dbFor('owner-uid'),'workspaces',ws,'orders','TEST-CLOSED'), {total:10000}));
  await assertSucceeds(setDoc(doc(db,'workspaces',ws,'orders','TEST-OPS-CREATE'), {
    orderId:'TEST-OPS-CREATE', dispatcher:'Артём',
    _createdBy:'artem', _createdByName:'Артём', _createdByShift:'artem',
    _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertFails(setDoc(doc(db,'workspaces',ws,'orders','TEST-OPS-FORGED-CLOSE'), {
    orderId:'TEST-OPS-FORGED-CLOSE', dispatcher:'Артём', master:'Иван',
    _createdBy:'artem', _createdByName:'Артём', _createdByShift:'artem',
    _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem',
    _status:'Выполнен', total:50000, masterAmount:50000, companyShare:0
  }));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OPS-CREATE'), {
    _createdByName:'Сергей', _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
});

test('closed shift report freezes regular orders while pickups remain editable until paid report', async () => {
  const db=dbFor('sergey-ops-uid'), actor={_updatedBy:'sergey',_updatedByName:'Сергей',_updatedByShift:'sergey'};
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    await setDoc(doc(admin,'workspaces',ws,'orders','TEST-REPORTED'),{orderId:'TEST-REPORTED',callDate:'2026-10-08',_createdBy:'sergey',_createdByName:'Сергей',_createdByShift:'sergey',_status:'Выполнен',total:5000});
    await setDoc(doc(admin,'workspaces',ws,'dispatcherOrders','TEST-REPORTED'),{orderId:'TEST-REPORTED',callDate:'2026-10-08',_status:'Выполнен'});
    await setDoc(doc(admin,'workspaces',ws,'orders','TEST-PICKUP'),{orderId:'TEST-PICKUP',callDate:'2026-10-08',_createdBy:'sergey',_createdByName:'Сергей',_createdByShift:'sergey',_status:'Забор / техника у мастера',_isPickup:true,total:5000});
    await setDoc(doc(admin,'workspaces',ws,'dispatcherOrders','TEST-PICKUP'),{orderId:'TEST-PICKUP',callDate:'2026-10-08',_status:'Забор / техника у мастера',_isPickup:true});
    await setDoc(doc(admin,'workspaces',ws,'shiftReports','2026-10-08-sergey'),{id:'2026-10-08-sergey',date:'2026-10-08',shift:'sergey',orderIds:['TEST-REPORTED','TEST-PICKUP'],lockedOrderIds:['TEST-REPORTED'],paidOrderIds:[]});
  });
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-REPORTED'),{total:6000,...actor}));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-PICKUP'),{total:6000,_status:'Выполнен',_cashClosedOn:'2026-10-12',...actor}));
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    await setDoc(doc(admin,'workspaces',ws,'shiftReports','2026-10-12-sergey'),{id:'2026-10-12-sergey',date:'2026-10-12',shift:'sergey',orderIds:[],lockedOrderIds:['TEST-PICKUP'],paidOrderIds:['TEST-PICKUP']});
    await updateDoc(doc(admin,'workspaces',ws,'dispatcherOrders','TEST-PICKUP'),{_reportLockId:'2026-10-12-sergey'});
  });
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-PICKUP'),{total:7000,...actor}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-PICKUP'),{_reportLockId:'forged',...actor}));
});

test('dispatcher-logistic closes a day with an immutable lock-only closure; closure markers require the same batch', async () => {
  const db=dbFor('sergey-ops-uid'),actor={_updatedBy:'sergey',_updatedByName:'Сергей',_updatedByShift:'sergey'};
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    await setDoc(doc(admin,'workspaces',ws,'orders','TEST-CLOSURE-ORDER'),{orderId:'TEST-CLOSURE-ORDER',callDate:'2026-10-10',_status:'Выполнен'});
    await setDoc(doc(admin,'workspaces',ws,'dispatcherOrders','TEST-CLOSURE-ORDER'),{orderId:'TEST-CLOSURE-ORDER',callDate:'2026-10-10',_status:'Выполнен'});
    // A pickup can be accepted by one shift and closed by the other.
    await setDoc(doc(admin,'workspaces',ws,'orders','TEST-CLOSURE-PICKUP'),{orderId:'TEST-CLOSURE-PICKUP',callDate:'2026-10-08',_createdBy:'artem',_createdByName:'Артём',_createdByShift:'artem',_status:'Выполнен',_isPickup:true,_cashClosedOn:'2026-10-10'});
    await setDoc(doc(admin,'workspaces',ws,'dispatcherOrders','TEST-CLOSURE-PICKUP'),{orderId:'TEST-CLOSURE-PICKUP',callDate:'2026-10-08',_status:'Выполнен',_isPickup:true,_cashClosedOn:'2026-10-10'});
  });
  const closure={id:'2026-10-10-sergey',date:'2026-10-10',shift:'sergey',shiftName:'Смена Сергея',closedBy:'sergey',closedByName:'Сергей',closedAt:new Date().toISOString(),serverClosedAt:serverTimestamp(),orderIds:['TEST-CLOSURE-ORDER','TEST-CLOSURE-PICKUP'],lockedOrderIds:['TEST-CLOSURE-ORDER','TEST-CLOSURE-PICKUP']};
  const batch=writeBatch(db);
  batch.set(doc(db,'workspaces',ws,'shiftClosures',closure.id),closure);
  batch.update(doc(db,'workspaces',ws,'dispatcherOrders','TEST-CLOSURE-ORDER'),{_reportLockId:closure.id,...actor});
  batch.update(doc(db,'workspaces',ws,'dispatcherOrders','TEST-CLOSURE-PICKUP'),{_reportLockId:closure.id,...actor});
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'shiftClosures',closure.id)));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-CLOSURE-ORDER'),{total:9000,...actor}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'orders','TEST-CLOSURE-PICKUP'),{total:9000,...actor}));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-CLOSURE-ORDER'),{_status:'В работе',...actor}));
  await assertFails(setDoc(doc(db,'workspaces',ws,'shiftClosures','2026-10-11-sergey'),{...closure,id:'2026-10-11-sergey',date:'2026-10-11',salary:9000,serverClosedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'shiftClosures',closure.id)));
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftClosures',closure.id)));
});

test('Sergey and Artem dispatcher-logistics share one workspace order queue across shifts', async () => {
  const sergey = dbFor('sergey-ops-uid');
  const artem = dbFor('ops-uid');
  const canonical = doc(sergey, 'workspaces', ws, 'orders', 'TEST-OWN');
  const safeMirror = doc(sergey, 'workspaces', ws, 'dispatcherOrders', 'TEST-OWN');

  // Both shift profiles read the same sanitized mirror, never the full order.
  await assertFails(getDoc(canonical));
  await assertFails(getDoc(doc(artem, 'workspaces', ws, 'orders', 'TEST-OWN')));
  await assertFails(getDocs(collection(sergey, 'workspaces', ws, 'orders')));
  await assertFails(getDocs(collection(artem, 'workspaces', ws, 'orders')));
  await assertSucceeds(getDoc(safeMirror));
  await assertSucceeds(getDoc(doc(artem, 'workspaces', ws, 'dispatcherOrders', 'TEST-OWN')));
  await assertSucceeds(getDocs(collection(sergey, 'workspaces', ws, 'dispatcherOrders')));
  await assertSucceeds(getDocs(collection(artem, 'workspaces', ws, 'dispatcherOrders')));
});

test('order close data is visible only to owner and shift closers, and freezes after a shift report', async () => {
  const sergey=dbFor('sergey-ops-uid');
  const owner=dbFor('owner-uid');
  const dispatcher=dbFor('dispatch-uid');
  const orderId='TEST-CLOSE-DATA';
  const actor={_updatedBy:'sergey',_updatedByName:'Сергей',_updatedByShift:'sergey'};
  const closeDoc=doc(sergey,'workspaces',ws,'orderCloseData',orderId);
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    await setDoc(doc(admin,'workspaces',ws,'orders',orderId),{orderId,callDate:'2026-10-11',_status:'Выполнен'});
  });
  await assertSucceeds(setDoc(closeDoc,{orderId,total:12000,parts:2000,closeDate:'11.10',...actor}));
  await assertSucceeds(updateDoc(closeDoc,{total:13000,...actor}));
  await assertSucceeds(getDoc(doc(owner,'workspaces',ws,'orderCloseData',orderId)));
  await assertSucceeds(getDoc(closeDoc));
  await assertFails(getDoc(doc(dispatcher,'workspaces',ws,'orderCloseData',orderId)));
  await assertFails(getDocs(collection(dispatcher,'workspaces',ws,'orderCloseData')));
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    await setDoc(doc(admin,'workspaces',ws,'shiftReports','2026-10-11-sergey'),{
      id:'2026-10-11-sergey',date:'2026-10-11',shift:'sergey',orderIds:[orderId],paidOrderIds:[]
    });
  });
  await assertFails(updateDoc(closeDoc,{total:14000,...actor}));
});

test('dispatcher profiles see only the shared sanitized queue, not canonical financial records', async () => {
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
    visitTime:'14:00', _updatedBy:'logistic', _updatedByName:'Логист', _updatedByShift:'sergey'
  }));
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'orders','TEST-OWN'), {
    companyShare:999999, _updatedBy:'logistic', _updatedByName:'Логист', _updatedByShift:'sergey'
  }));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
});

test('employee roles cannot create, promote, disable, or edit member accounts', async () => {
  for (const uid of ['ops-uid','dispatch-uid','logistic-uid','master-uid']) {
    const db=dbFor(uid);
    await assertFails(getDoc(doc(db,'workspaces',ws,'members','owner-uid')));
    await assertFails(getDocs(collection(db,'workspaces',ws,'members')));
    await assertFails(updateDoc(doc(db,'workspaces',ws,'members',uid), {role:'owner',active:true}));
    await assertFails(setDoc(doc(db,'workspaces',ws,'members','injected-'+uid), {role:'owner',active:true}));
  }
  const staffQuery=query(collection(dbFor('ops-uid'),'workspaces',ws,'members'),where('role','!=','owner'));
  await assertSucceeds(getDocs(staffQuery));
  await assertFails(getDocs(collection(dbFor('master-uid'),'workspaces',ws,'members')));
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'members','ops-uid')));
  await assertSucceeds(getDocs(collection(dbFor('owner-uid'),'workspaces',ws,'members')));
});

test('operational roles cannot inject finance fields into the dispatcher mirror', async () => {
  const db=dbFor('ops-uid');
  await assertSucceeds(updateDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-OWN'), {
    _status:'В работе', _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertFails(updateDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-OWN'), {
    salary:999999, _updatedBy:'artem', _updatedByName:'Артём', _updatedByShift:'artem'
  }));
  await assertFails(deleteDoc(doc(db,'workspaces',ws,'dispatcherOrders','TEST-OWN')));
});

test('Sergey and Artem can prepare and close master orders until the shift report closes', async () => {
  for (const [uid,id,name,shift,orderId] of [
    ['sergey-ops-uid','sergey','Сергей','sergey','TEST-CLOSE-SERGEY'],
    ['ops-uid','artem','Артём','artem','TEST-CLOSE-ARTEM'],
    ['logistic-uid','logistic','Логист','sergey','TEST-CLOSE-LOGISTIC']
  ]) {
    const db=dbFor(uid);
    const actorFields={_updatedBy:id,_updatedByName:name,_updatedByShift:shift};
    const open=doc(db,'workspaces',ws,'orders',orderId);
    await assertSucceeds(updateDoc(open,{total:15000,parts:2000,cleanCheck:13000,masterAmount:6000,companyShare:7000,...actorFields}));
    await assertSucceeds(updateDoc(open,{_status:'Выполнен',closeDate:'2026-10-11',...actorFields}));
    await assertSucceeds(updateDoc(open,{total:1,...actorFields}));
    await assertSucceeds(updateDoc(open,{master:'Петр',...actorFields}));
  }
  const mirror=doc(dbFor('ops-uid'),'workspaces',ws,'dispatcherOrders','TEST-CLOSED');
  await assertSucceeds(updateDoc(mirror,{_status:'В работе',_updatedBy:'artem',_updatedByName:'Артём',_updatedByShift:'artem'}));
  const assignment=doc(dbFor('master-uid'),'workspaces',ws,'masterAssignments','TEST-CLOSED');
  await assertFails(updateDoc(assignment,{_masterStage:'work',_status:'В работе'}));
});

test('master reads only own sanitized assignment and no canonical order', async () => {
  const db=dbFor('master-uid');
  await assertSucceeds(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OWN')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OTHER')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'orders','TEST-OWN')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'orders','TEST-OTHER')));
  await assertFails(getDoc(doc(db,'workspaces',ws,'masterAssignments','TEST-OTHER')));
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
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','payrollPolicy')));
  await assertFails(getDoc(doc(dbFor('master-uid'),'workspaces',ws,'config','payrollPolicy')));
  await assertFails(getDoc(doc(dbFor('dispatch-uid'),'workspaces',ws,'config','payrollPolicy')));
  await assertFails(updateDoc(doc(dbFor('ops-uid'),'workspaces',ws,'config','payrollPolicy'), {shiftBasePay:1}));
});

test('shift reports are private per staff member and use one deterministic daily id', async () => {
  const db=dbFor('ops-uid');
  const ref=doc(db,'workspaces',ws,'shiftReports','2026-09-23-artem');
  const valid={id:'2026-09-23-artem',date:'2026-09-23',closedBy:'artem',closedByName:'Артём',shift:'artem',shiftName:'Смена Артёма',orders:8,financialOrders:4,completed:3,active:2,refused:1,cancelled:0,unassigned:0,reviewPending:0,reviews:2,reviewRate:66.7,turnover:60000,cash:50000,avgCheck:15000,salary:5000,basePay:2000,cashThreshold:20000,cashRate:10,orderIds:['a','b'],dataHash:'hash',closedAt:new Date().toISOString(),serverClosedAt:serverTimestamp()};
  await assertFails(setDoc(ref,valid));
  const lateSettlement={...valid,id:'2026-09-25-artem',date:'2026-09-25',orders:1,financialOrders:1,completed:1,turnover:35000,cash:35000,shiftCash:0,deferredCash:35000,salary:3500,orderIds:['late-1'],paidOrderIds:['late-1'],deferredOrderIds:['late-1'],settlementVersion:1,serverClosedAt:serverTimestamp()};

  await assertFails(setDoc(doc(db,'workspaces',ws,'shiftReports','2026-09-26-artem'),{...lateSettlement,id:'2026-09-26-artem',date:'2026-09-26',cash:35000,shiftCash:1000,deferredCash:1000,serverClosedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(dbFor('backup-ops-uid'),'workspaces',ws,'shiftReports',valid.id),{...valid,closedBy:'backup',closedByName:'Запасной',serverClosedAt:serverTimestamp()}));
  const sergeyDb=dbFor('sergey-ops-uid');
  const sergey={...valid,id:'2026-09-23-sergey',closedBy:'sergey',closedByName:'Сергей',shift:'sergey',shiftName:'Смена Сергея',cash:1000,salary:2000,turnover:5000,avgCheck:5000,serverClosedAt:serverTimestamp()};
  await assertFails(setDoc(doc(sergeyDb,'workspaces',ws,'shiftReports',sergey.id),sergey));
  await env.withSecurityRulesDisabled(async ctx=>{const admin=ctx.firestore();await setDoc(doc(admin,'workspaces',ws,'shiftReports',valid.id),valid);await setDoc(doc(admin,'workspaces',ws,'shiftReports',lateSettlement.id),lateSettlement);await setDoc(doc(admin,'workspaces',ws,'shiftReports',sergey.id),sergey)});
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
  await assertSucceeds(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'config','payroll'), {historyJson:'{"version":1,"status":"reconciliation_only"}'}));
  const ownerApproved={...valid,id:'2026-09-27-artem',date:'2026-09-27',closedBy:'owner-uid',closedByName:'Владелец',shift:'artem',shiftName:'Смена Артёма',turnover:5000,cash:1000,avgCheck:5000,salary:2000,subjectMemberId:'artem',approvedFor:'artem',approvedForName:'Артём',ownerConfirmed:true,ownerApprovedBy:'owner-uid',ownerApprovedByName:'Владелец',ownerApprovedAt:new Date().toISOString(),serverClosedAt:serverTimestamp(),serverApprovedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftReports',ownerApproved.id),ownerApproved));
  const roundedPercentageReport={...ownerApproved,id:'2026-09-28-sergey',date:'2026-09-28',shift:'sergey',shiftName:'Смена Сергея',subjectMemberId:'sergey',approvedFor:'sergey',approvedForName:'Сергей',cash:31308,turnover:31308,avgCheck:31308,salary:3131,serverClosedAt:serverTimestamp(),serverApprovedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftReports',roundedPercentageReport.id),roundedPercentageReport));
  await assertFails(setDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftReports','2026-09-29-sergey'),{...roundedPercentageReport,id:'2026-09-29-sergey',date:'2026-09-29',salary:3132,serverClosedAt:serverTimestamp(),serverApprovedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(dbFor('ops-uid'),'workspaces',ws,'shiftReports',ownerApproved.id)));
  await assertSucceeds(getDoc(doc(dbFor('owner-uid'),'workspaces',ws,'shiftReports',ownerApproved.id)));
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
