/* CRM_UNIT:PRESETS-5cd5988cc4c6 */
const PRESETS={directions:["ПК","ТВ","БТ"],cities:["СПб"],dispatchers:[],masters:["Дорошенко Юрий","Власов Роман","Савченков Никита","Максим Петренко","Пак Семён","Костромин Николай","Журавлёв Ярослав","Есментов Юрий","Федотенко Василий","Артем Куриди","Лившиц Михаил","Ульянцев Алексей","Владимир Иванович","Семёнов Роман"]};/* CRM_END:PRESETS-5cd5988cc4c6 */
/* CRM_UNIT:HEADERS-66318dec10a1 */
const HEADERS=['0.0','нпр','Город','Дата Звонка','Время звонка','Дата выезда','Время выезд','Имя','Конт. номер','Адрес','Запрос','Мастер','Дисп','ПП','З/Ч','Чистый чек','Общая сумма','Процент мастера','Сдача','Отзыв','Дата сдачи заявки'];/* CRM_END:HEADERS-66318dec10a1 */
/* CRM_UNIT:KEYS-e3ade43bac5e */
const KEYS=['a0','direction','city','callDate','callTime','visitDate','visitTime','name','phone','address','request','master','dispatcher','pp','parts','cleanCheck','total','masterAmount','companyShare','review','closeDate'];/* CRM_END:KEYS-e3ade43bac5e */
/* CRM_UNIT:APP_HEADERS-89dae34ea3f2 */
const APP_HEADERS=['ID заказа',...HEADERS.slice(1)];/* CRM_END:APP_HEADERS-89dae34ea3f2 */
/* CRM_UNIT:APP_KEYS-47024d710bf9 */
const APP_KEYS=['orderId',...KEYS.slice(1)];/* CRM_END:APP_KEYS-47024d710bf9 */
/* CRM_UNIT:LABELS-af51307ae05e */
const LABELS={a0:'0.0 (колонка A)',direction:'Направление (нпр)',city:'Город',callDate:'Дата звонка',callTime:'Время звонка',visitDate:'Дата выезда',visitTime:'Время выезда',name:'Имя',phone:'Конт. номер',address:'Адрес',request:'Запрос',master:'Мастер',dispatcher:'Диспетчер',pp:'ПП',parts:'З/Ч',cleanCheck:'Чистый чек',total:'Общая сумма',masterAmount:'Выплата мастеру',companyShare:'Сдача компании',review:'Отзыв',closeDate:'Дата / отметка сдачи заявки'};/* CRM_END:LABELS-af51307ae05e */
/* CRM_UNIT:STATUS_META-e51ce7bfad4d */
const STATUS_META={'Выполнен':{class:'status-green',color:'#00FF00',source:'#00FF00'},'В работе':{class:'status-yellow',color:'#FFFF00',source:'theme 6 / #FFFF00'},'Забор / техника у мастера':{class:'status-blue',color:'#4285F4',source:'theme 4 / #4285F4'},'Будущая дата':{class:'status-gray',color:'#CCCCCC',source:'#CCCCCC / #D9D9D9'},'На проверке':{class:'status-purple',color:'#8B5CF6',source:'workflow'},'Отказ':{class:'status-red',color:'#FF0000',source:'theme 5 / #FF0000'},'Отмена':{class:'status-orange',color:'#FF9900',source:'#FF9900 / #F9CB9C'}};/* CRM_END:STATUS_META-e51ce7bfad4d */
/* CRM_UNIT:STATUS_ORDER-c5706335410c */ const STATUS_ORDER=['В работе','Забор / техника у мастера','Будущая дата','На проверке','Выполнен','Отказ','Отмена'];/* CRM_END:STATUS_ORDER-c5706335410c */
/* CRM_UNIT:clean-261b7b93dc6f */
const clean=v=>v==null?'':String(v).trim();/* CRM_END:clean-261b7b93dc6f */
/* CRM_UNIT:norm-6d60250fb036 */ const norm=v=>clean(v).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();/* CRM_END:norm-6d60250fb036 */
/* CRM_UNIT:esc-9b205d5c660f */
const esc=v=>clean(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));/* CRM_END:esc-9b205d5c660f */
/* CRM_UNIT:numMaybe-8ffc3d64b266 */
function numMaybe(v){if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let s=clean(v);if(!s)return null;let neg=/^\(.*\)$/.test(s);s=s.replace(/[()\s\u00a0₽€$£]/g,'').replace(/[^0-9,.-]/g,'');if(!s||s==='-'||s==='.')return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0){if(c>d)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'')}else if(c>=0)s=s.replace(',','.');const n=Number(s);return Number.isFinite(n)?(neg?-Math.abs(n):n):null}/* CRM_END:numMaybe-8ffc3d64b266 */
/* CRM_UNIT:num-889072de6386 */
const num=v=>numMaybe(v)??0;/* CRM_END:num-889072de6386 */
/* CRM_UNIT:uid-7b425bb2dd8e */ const uid=()=>crypto?.randomUUID?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);/* CRM_END:uid-7b425bb2dd8e */
/* CRM_UNIT:parseDate-ee08a73dee34 */

function parseDate(v){if(!v)return null;if(v instanceof Date&&!isNaN(v))return new Date(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate()));if(typeof v==='number'&&v>1000&&v<90000)return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);let s=clean(v);let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);if(m){let y=+m[3];if(y<100)y+=2000;return new Date(Date.UTC(y,+m[2]-1,+m[1]))}return null}/* CRM_END:parseDate-ee08a73dee34 */
/* CRM_UNIT:iso-1f3770793236 */
const iso=d=>d instanceof Date&&!isNaN(d)?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:clean(d).match(/^\d{4}-\d{2}-\d{2}$/)?.[0]||'';/* CRM_END:iso-1f3770793236 */
/* CRM_UNIT:fmtDate-9c852657c996 */
const fmtDate=v=>{const d=parseDate(v);return d?new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC'}).format(d):clean(v)||'—'};/* CRM_END:fmtDate-9c852657c996 */
/* CRM_UNIT:today-fc88c9aae119 */
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};/* CRM_END:today-fc88c9aae119 */
/* CRM_UNIT:ddmm-7e44aad38ab5 */
const ddmm=()=>{const d=new Date();return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`};/* CRM_END:ddmm-7e44aad38ab5 */
/* CRM_UNIT:money-f0cbc3bddf82 */
function money(v){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:state.settings.currency||'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number.isFinite(v)?v:0)}/* CRM_END:money-f0cbc3bddf82 */
/* CRM_UNIT:integer-45638ccae914 */
const integer=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number.isFinite(v)?v:0);/* CRM_END:integer-45638ccae914 */
/* CRM_UNIT:pct-73a437a9dcf1 */ const pct=v=>Number.isFinite(v)?v.toFixed(1)+'%':'—';/* CRM_END:pct-73a437a9dcf1 */
/* CRM_UNIT:unique-fe008ed5febb */
function unique(a){return [...new Set(a.map(clean).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))}/* CRM_END:unique-fe008ed5febb */
/* CRM_UNIT:median-1a3598681d96 */
function median(a){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return 0;const m=(x.length-1)/2;return x[Math.floor(m)]+(x[Math.ceil(m)]-x[Math.floor(m)])*(m-Math.floor(m))}/* CRM_END:median-1a3598681d96 */
/* CRM_UNIT:sum-a6808df06ac0 */
function sum(a,f=x=>x){return a.reduce((s,x)=>s+(x?._duplicateOf?0:(Number(f(x))||0)),0)}/* CRM_END:sum-a6808df06ac0 */
/* CRM_UNIT:localDateParts-15523fa0f90a */
function localDateParts(v){const d=parseDate(v);return d?{y:d.getUTCFullYear(),m:d.getUTCMonth(),day:d.getUTCDate()}:null}/* CRM_END:localDateParts-15523fa0f90a */
/* CRM_UNIT:clockParts-c54ac801b360 */
function clockParts(v,fallback='09:00'){const s=clean(v||fallback),m=s.match(/([01]?\d|2[0-3])[:.]([0-5]\d)/);if(m)return [+m[1],+m[2]];const h=s.match(/^([01]?\d|2[0-3])\s*[-–—]/);if(h)return [+h[1],0];const f=clean(fallback).match(/([01]?\d|2[0-3])[:.]([0-5]\d)/);return f?[+f[1],+f[2]]:[9,0]}/* CRM_END:clockParts-c54ac801b360 */
/* CRM_UNIT:moscowTodayISO-a8b4639cbaa2 */
function moscowTodayISO(){try{const a=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${a.year}-${a.month}-${a.day}`}catch{return today()}}/* CRM_END:moscowTodayISO-a8b4639cbaa2 */
/* CRM_UNIT:moscowAppointmentDate-ef2508bba56b */
function moscowAppointmentDate(p,hm){return new Date(Date.UTC(p.y,p.m,p.day,hm[0]-3,hm[1],0,0))}/* CRM_END:moscowAppointmentDate-ef2508bba56b */
/* CRM_UNIT:minutesBetween-ae5481e2531c */

function minutesBetween(a,b){const x=Date.parse(a||''),y=Date.parse(b||'');return Number.isFinite(x)&&Number.isFinite(y)?(y-x)/60000:null}/* CRM_END:minutesBetween-ae5481e2531c */
/* CRM_UNIT:isExcelSerialTime-01db0335f5d8 */
function isExcelSerialTime(v){const text=clean(v);if(typeof v!=='number'&&!/^\d{4,5}(?:[.,]\d+)?$/.test(text))return false;const n=Number(text.replace(',','.'));return Number.isFinite(n)&&n>1000&&n<90000}/* CRM_END:isExcelSerialTime-01db0335f5d8 */
/* CRM_UNIT:download-5bb00b801e89 */
function download(name,blob){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)}/* CRM_END:download-5bb00b801e89 */
/* CRM_UNIT:mergeDeep-2023fa420bd4 */
function mergeDeep(a,b){const o={...(a||{})};for(const [k,v] of Object.entries(b||{})){o[k]=(v&&typeof v==='object'&&!Array.isArray(v))?mergeDeep(o[k]||{},v):v}return o}/* CRM_END:mergeDeep-2023fa420bd4 */
/* CRM_UNIT:hexSafe-ff7b7bb1637a */
function hexSafe(v,f){return /^#[0-9a-f]{6}$/i.test(String(v||''))?v:f}/* CRM_END:hexSafe-ff7b7bb1637a */
