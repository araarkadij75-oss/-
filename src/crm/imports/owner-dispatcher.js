/* CRM_UNIT:normalizeImportHeaders-2acda9c05ca2 */
function normalizeImportHeaders(raw){const names=new Map(HEADERS.map(h=>[clean(h).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' '),h]));return raw.map((v,i)=>{const key=clean(v).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');return (!key&&i===0)?HEADERS[0]:(names.get(key)||clean(v))})}/* CRM_END:normalizeImportHeaders-2acda9c05ca2 */
