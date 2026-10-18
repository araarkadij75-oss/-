// Small Firestore-compatible adapter for the EliteService MySQL API.
// Authentication remains Firebase Auth; documents and live updates use REG.RU.
let connection = null;
const POLL_MS = 8000;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalizePath(parts) {
  const path = parts.map(String).join('/').replace(/^\/+|\/+$/g, '');
  if (!path || path.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('Некорректный путь данных');
  return path;
}
function pathOf(ref) { return typeof ref === 'string' ? ref : ref?.path; }
function ref(path, kind) { return Object.freeze({ path, id: path.split('/').at(-1), kind }); }
function decodeData(data) { return clone(data || {}); }
function documentSnapshot(row) {
  const data = decodeData(row?.data);
  return { id: String(row?.id || ''), ref: ref(row?.path || '', 'document'), exists: () => !!row?.exists, data: () => row?.exists ? clone(data) : undefined };
}
function querySnapshot(rows) {
  const docs = (rows || []).map(documentSnapshot);
  return { docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => docs.map((doc, newIndex) => ({ type: 'added', doc, oldIndex: -1, newIndex })) };
}
function encoded(value) {
  if (value instanceof Timestamp) return { __eliteTimestamp: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof ServerTimestamp) return { __eliteTimestamp: true, seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
  if (Array.isArray(value)) return value.map(encoded);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encoded(v)]));
  return value;
}
async function request(payload) {
  if (!connection) throw new Error('REG.RU база не настроена');
  const token = await connection.tokenProvider?.();
  if (!token) throw new Error('Войдите в CRM повторно для проверки доступа');
  let response;
  try {
    response = await fetch(connection.apiBase, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  } catch { throw new Error('Нет связи с сервером EliteService'); }
  let body;
  try { body = await response.json(); } catch { throw new Error(`Сервер EliteService вернул ошибку (${response.status})`); }
  if (!response.ok || body?.ok !== true) {
    const messages = { Authentication_required: 'Войдите в CRM повторно', 'Account_is_not_enabled': 'Профиль не включён в новую базу', 'Order_is_frozen_by_a_closed_shift_report': 'Заказ зафиксирован закрытым отчётом', phone_locked: 'Телефон мастеру пока закрыт' };
    const code = String(body?.error || 'service_unavailable');
    const key = code.replace(/\s+/g, '_');
    throw new Error(messages[key] || code.replace(/_/g, ' '));
  }
  return body;
}
function resolveCollection(target) {
  if (target?.kind === 'query') return { path: target.path, constraints: target.constraints || [] };
  return { path: pathOf(target), constraints: [] };
}

export function configure(options) {
  const apiBase = String(options?.apiBase || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(apiBase)) throw new Error('Для REG.RU API требуется HTTPS');
  if (typeof options?.tokenProvider !== 'function') throw new Error('Не настроена проверка входа');
  connection = { apiBase, tokenProvider: options.tokenProvider };
}
export async function health() {
  if (!connection) throw new Error('REG.RU API не настроен');
  let response;
  try { response = await fetch(`${connection.apiBase}?action=health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error('Нет связи с сервером EliteService'); }
  if (!response.ok) throw new Error(`REG.RU API недоступен (HTTP ${response.status})`);
  const result = await response.json();
  if (result?.ok !== true || result?.database !== 'ready') throw new Error('REG.RU API не подтвердил готовность базы');
  return result;
}
export function getFirestore() { return {}; }
export function collection(_db, ...segments) { const parent = segments.map(x => typeof x === 'string' ? x : pathOf(x)).join('/'); return ref(normalizePath([parent]), 'collection'); }
export function doc(_db, ...segments) {
  if (segments.length === 0 && _db?.kind === 'collection') {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
    return ref(normalizePath([`${pathOf(_db)}/${random}`]), 'document');
  }
  const path = segments.map(x => typeof x === 'string' ? x : pathOf(x)).join('/');
  const full = normalizePath([path]); if (full.split('/').length % 2 !== 0) throw new Error('Некорректный путь документа');
  return ref(full, 'document');
}
export function where(field, op, value) { return { type: 'where', field: String(field), op: String(op), value: encoded(value) }; }
export function orderBy(field, direction = 'asc') { return { type: 'orderBy', field: String(field), direction: direction === 'desc' ? 'desc' : 'asc' }; }
export function limit(count) { return { type: 'limit', count: Math.max(1, Math.min(5000, Number(count) || 1)) }; }
export function query(base, ...constraints) {
  const parsed = resolveCollection(base);
  if (parsed.path.split('/').length % 2 !== 1) throw new Error('Ожидалась коллекция');
  return Object.freeze({ path: parsed.path, kind: 'query', constraints: [...parsed.constraints, ...constraints] });
}
export async function getDoc(documentRef) {
  const result = await request({ op: 'getDoc', path: pathOf(documentRef) });
  return documentSnapshot({ id: pathOf(documentRef).split('/').at(-1), path: pathOf(documentRef), exists: !!result.exists, data: result.data });
}
export async function getDocs(queryRef) {
  const { path, constraints } = resolveCollection(queryRef);
  const result = await request({ op: 'query', path, constraints });
  return querySnapshot((result.docs || []).map(x => ({ ...x, path: `${path}/${x.id}`, exists: true })));
}
export async function setDoc(documentRef, data, options = {}) {
  await request({ op: 'batch', writes: [{ type: 'set', path: pathOf(documentRef), data: encoded(data), merge: !!options.merge }] });
}
export async function deleteDoc(documentRef) { await request({ op: 'batch', writes: [{ type: 'delete', path: pathOf(documentRef) }] }); }
export function writeBatch() {
  const writes = []; let committed = false;
  return {
    set(documentRef, data, options = {}) { if (committed) throw new Error('Пакет уже отправлен'); writes.push({ type: 'set', path: pathOf(documentRef), data: encoded(data), merge: !!options.merge }); return this; },
    update(documentRef, data) { if (committed) throw new Error('Пакет уже отправлен'); writes.push({ type: 'update', path: pathOf(documentRef), data: encoded(data) }); return this; },
    delete(documentRef) { if (committed) throw new Error('Пакет уже отправлен'); writes.push({ type: 'delete', path: pathOf(documentRef) }); return this; },
    async commit() { if (committed) throw new Error('Пакет уже отправлен'); committed = true; if (!writes.length) return; await request({ op: 'batch', writes }); }
  };
}
export function onSnapshot(target, next, error = () => {}) {
  const isDoc = target?.kind === 'document'; let active = true, timer = null, version = null, lastDoc = null;
  const deliver = async () => {
    if (!active) return;
    try {
      if (isDoc) {
        const snap = await getDoc(target); const data = snap.exists() ? JSON.stringify(snap.data()) : 'missing';
        if (data !== lastDoc) { lastDoc = data; next(snap); }
      } else {
        const { path, constraints } = resolveCollection(target);
        const result = await request({ op: 'query', path, constraints, since: version });
        if (result.unchanged) return;
        version = Number(result.version) || 0;
        next(querySnapshot((result.docs || []).map(x => ({ ...x, path: `${path}/${x.id}`, exists: true }))));
      }
    } catch (e) { if (active) { try { error(e); } catch {} } }
  };
  deliver(); timer = setInterval(deliver, POLL_MS);
  return () => { active = false; clearInterval(timer); timer = null; };
}
export function serverTimestamp() { return new ServerTimestamp(); }
class ServerTimestamp {}
export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = Number(seconds) || 0; this.nanoseconds = Number(nanoseconds) || 0; }
  toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  static fromDate(value) { return Timestamp.fromMillis(value.getTime()); }
  static fromMillis(value) { const millis = Number(value) || 0; const seconds = Math.floor(millis / 1000); return new Timestamp(seconds, Math.floor((millis - seconds * 1000) * 1e6)); }
}
