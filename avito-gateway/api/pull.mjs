import {reply,preflight,authorize,avito,account,integrationEnabled} from './_lib.mjs';
const asArray=value=>Array.isArray(value)?value:[];
export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(preflight(req,res))return;
  if(!integrationEnabled())return reply(res,410,{ok:false,error:'integration_disabled'},origin);
  if(req.method!=='GET')return reply(res,405,{ok:false,error:'method'},origin);
  if(!await authorize(req,res))return;
  try{
    const ownId=await account();
    const sinceRaw=String(req.query?.since||'');
    const parsed=/^\d{4}-\d{2}-\d{2}T/.test(sinceRaw)?new Date(sinceRaw):new Date(Date.now()-24*3600e3);
    const safeSince=new Date(Math.max(parsed.getTime()||0,Date.now()-7*86400e3));
    const [callsResult,chatsResult]=await Promise.allSettled([
      avito('/cpa/v2/callsByTime',{method:'POST',body:JSON.stringify({dateTimeFrom:safeSince.toISOString(),limit:100,offset:0})}),
      avito(`/messenger/v2/accounts/${encodeURIComponent(ownId)}/chats?limit=100&offset=0`)
    ]);
    const callsData=callsResult.status==='fulfilled'?callsResult.value:{calls:[]};
    const chatsData=chatsResult.status==='fulfilled'?chatsResult.value:{chats:[]};
    const calls=asArray(callsData.calls).map(c=>({id:`call:${c.id}`,kind:'call',externalId:String(c.id),phone:String(c.buyerPhone||''),itemId:String(c.itemId||''),createdAt:c.createTime||c.startTime||'',duration:Number(c.duration||0),recordUrl:c.recordUrl||'',title:c.groupTitle||'Звонок с Avito'}));
    const chats=asArray(chatsData.chats).filter(c=>{const changed=Number(c.updated||c.created||0);return !changed||changed*1000>=safeSince.getTime()}).map(c=>{const customer=c.users?.find?.(u=>String(u.id)!==ownId),lastInbound=String(c.last_message?.author_id||'')!==ownId,unreadCount=Number(c.unread_count||0);return{id:`chat:${c.id}`,kind:'message',externalId:String(c.id),itemId:String(c.context?.value?.id||c.item_id||''),createdAt:c.updated||c.created||'',name:customer?.name||'',title:customer?.name||c.context?.value?.title||'Клиент Avito',preview:c.last_message?.content?.text||(c.last_message?.content?.voice?.voice_id?'Голосовое сообщение':''),unreadCount,lastInbound,attention:lastInbound}});
    const errors=[callsResult,chatsResult].filter(x=>x.status==='rejected').map(x=>String(x.reason?.message||x.reason));
    if(callsResult.status==='rejected'&&chatsResult.status==='rejected')throw new Error(errors.join('; '));
    console.info('avito_pull',JSON.stringify({calls:calls.length,chats:chats.length,attention:chats.filter(x=>x.attention).length,warnings:errors.length}));
    return reply(res,200,{ok:true,serverTime:new Date().toISOString(),calls,chats,warnings:errors},origin);
  }catch(error){return reply(res,502,{ok:false,error:'upstream',message:String(error.message||error)},origin)}
}
