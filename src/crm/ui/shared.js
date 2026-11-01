/* CRM_UNIT:$-0d332a6d83e9 */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];/* CRM_END:$-0d332a6d83e9 */
/* CRM_UNIT:log-87f9014907a4 */
function log(type,text){state.audit.unshift({at:new Date().toISOString(),type,text});state.audit=state.audit.slice(0,400)}/* CRM_END:log-87f9014907a4 */
/* CRM_UNIT:toast-bd39ae2e7c29 */
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)}/* CRM_END:toast-bd39ae2e7c29 */
/* CRM_UNIT:betaNotificationAllowedFor-2cb2d674107e */
function betaNotificationAllowedFor(r){const role=currentRole(),u=currentUser();if(role==='master')return canonicalKey(r?.master,'master')===canonicalKey(u?.master,'master');return true}/* CRM_END:betaNotificationAllowedFor-2cb2d674107e */
/* CRM_UNIT:betaNotify-848fe6ec2f46 */
function betaNotify(title,body,tag='master-ai-beta'){window.__betaNotificationEvents.push({at:new Date().toISOString(),title,body,tag});if(window.__betaNotificationEvents.length>100)window.__betaNotificationEvents.shift();const dedupeKey='MASTER_AI_NOTIFY_V2_'+tag;try{if(localStorage.getItem(dedupeKey))return false;localStorage.setItem(dedupeKey,new Date().toISOString());if('Notification' in window&&Notification.permission==='granted')new Notification(title,{body,icon:'./icon.svg',tag});return true}catch(e){console.warn('Notification',e);return false}}/* CRM_END:betaNotify-848fe6ec2f46 */
/* CRM_UNIT:betaUpdateNotificationButtons-7948d1635939 */
function betaUpdateNotificationButtons(){const granted=('Notification' in window)&&Notification.permission==='granted';for(const id of ['enableNotifications','enableNotificationsTop']){const b=$('#'+id);if(b){b.textContent=granted?'🔔 Уведомления включены':'🔔 Уведомления';b.classList.toggle('primary',granted)}}}/* CRM_END:betaUpdateNotificationButtons-7948d1635939 */
/* CRM_UNIT:betaEnableNotifications-d0ca1b082b9d */
async function betaEnableNotifications(){if(!('Notification' in window)){toast('Уведомления не поддерживаются этим браузером');return}const p=await Notification.requestPermission();if(p==='granted'){localStorage.setItem('MASTER_AI_BETA_NOTIFY_V1','1');betaUpdateNotificationButtons();betaNotify('EliteService','Уведомления работают. Новые заказы и изменения будут показаны, пока EliteService открыт.','notification-test-'+Date.now());toast('Уведомления включены')}else{localStorage.removeItem('MASTER_AI_BETA_NOTIFY_V1');betaUpdateNotificationButtons();toast('Разрешение на уведомления не выдано')}}/* CRM_END:betaEnableNotifications-d0ca1b082b9d */
/* CRM_UNIT:betaUpcomingReminders-dd613d60e2c1 */
function betaUpcomingReminders(){if(!('Notification' in window)||Notification.permission!=='granted')return;const now=new Date(),todayStr=today();for(const r of roleVisibleOrders(state.orders)){if(r.visitDate!==todayStr||!r.visitTime||['Выполнен','Отказ','Отмена'].includes(clean(r._status)))continue;const m=clean(r.visitTime).match(/(\d{1,2}):(\d{2})/);if(!m)continue;const when=new Date(now);when.setHours(+m[1],+m[2],0,0);const diff=when-now;if(diff<0||diff>30*60*1000)continue;const k='MASTER_AI_BETA_REMINDER_'+betaOrderKey(r)+'_'+todayStr+'_'+m[1]+m[2];if(localStorage.getItem(k))continue;localStorage.setItem(k,'1');betaNotify('EliteService · Скоро выезд',`${r.orderId||''} · ${r.visitTime} · ${r.address||r.city||r.name||''}`,'reminder-'+betaOrderKey(r))}}/* CRM_END:betaUpcomingReminders-dd613d60e2c1 */
/* CRM_UNIT:fillDatalists-913eec741a00 */
function fillDatalists(){const vals={directionList:unique([...PRESETS.directions,...state.orders.map(x=>x.direction)]),cityList:unique([...PRESETS.cities,...state.orders.map(x=>x.city)]),masterList:aiEligibleMasters(),dispatcherList:canonicalNameChoices([...PRESETS.dispatchers,...state.orders.map(x=>x.dispatcher)],'dispatcher')};for(const [id,a] of Object.entries(vals))$('#'+id).innerHTML=a.map(v=>`<option value="${esc(v)}"></option>`).join('');if($('#adminViewMaster')){const cur=$('#adminViewMaster').value;$('#adminViewMaster').innerHTML='<option value="">Выберите мастера</option>'+vals.masterList.filter(x=>!isServiceMaster(x)).map(v=>`<option>${esc(v)}</option>`).join('');if(vals.masterList.includes(cur))$('#adminViewMaster').value=cur}}/* CRM_END:fillDatalists-913eec741a00 */
/* CRM_UNIT:switchTab-0a5fbc31ee87 */
function switchTab(t){if(t==='finance'&&document.getElementById('profitPanel'))t='profit';if(!roleMeta().tabs.includes(t))t='orders';$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));$$('.section').forEach(x=>x.classList.toggle('active',x.dataset.panel===t));refresh()}/* CRM_END:switchTab-0a5fbc31ee87 */
/* CRM_UNIT:renderRoleWorkGuide-dba80b0c2528 */

function renderRoleWorkGuide(){
 const el=$('#roleWorkGuide'); if(!el)return;
 const role=currentRole();
 if(role==='owner'){el.hidden=true;el.replaceChildren();return}
 const copy={
  dispatcher_logistic:['Рабочий порядок диспетчера‑логиста','1) Создайте заказ и заполните клиента, адрес, запрос и время выезда. 2) Сразу выберите мастера. 3) Следите за этапами: назначен → принят → выехал → на месте → в работе. 4) После отчёта мастера заказ появится «На проверке»: сверьте данные и нажмите «Подтвердить закрытие» либо «Вернуть мастеру».'],
  master:['Рабочий порядок мастера','Откройте назначенный заказ и проходите этапы по порядку: «Принять» → «Выехал» → «На месте» → «Начать работу» → «Завершить и отправить на проверку». В отчёте укажите фактическую сумму, материалы и комментарий. Окончательно заказ закрывает диспетчер‑логист после проверки.'],
  dispatcher:['Рабочий порядок диспетчера','Создайте заявку и заполните данные клиента, адрес, запрос и время выезда. Распределение мастеров выполняет диспетчер‑логист.'],
  logistic:['Рабочий порядок диспетчера-логиста','Распределяйте заказы между мастерами, контролируйте этапы выполнения и сдачу по заказам.']
 };
 const x=copy[role];
 if(!x){el.hidden=true;el.replaceChildren();return}
 el.hidden=false;
 el.innerHTML=`<div class="guide-title">${x[0]}</div><div class="guide-text">${x[1]}</div>`;
}/* CRM_END:renderRoleWorkGuide-dba80b0c2528 */
