import {reply,preflight,authorize,positiveId,safeId,b2bhelp,sendError} from './_lib.mjs';

export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(preflight(req,res,'POST,OPTIONS'))return;
  if(req.method!=='POST')return reply(res,405,{ok:false,error:'method'},origin);
  if(!await authorize(req,res,['owner','dispatcher_logistic']))return;
  const chatId=safeId(req.body?.chat_id);
  const accountId=positiveId(req.body?.account_id);
  if(!chatId||!accountId)return reply(res,400,{ok:false,error:'fields'},origin);
  try{
    const result=await b2bhelp('/msg-center/chat/read',{method:'POST',body:{chat_id:chatId,account_id:accountId}});
    return reply(res,200,{ok:true,result},origin);
  }catch(error){return sendError(res,error,origin)}
}
