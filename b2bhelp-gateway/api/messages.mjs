import {reply,preflight,authorize,pageParam,positiveId,safeId,b2bhelp,sendError} from './_lib.mjs';

export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(preflight(req,res,'GET,OPTIONS'))return;
  if(req.method!=='GET')return reply(res,405,{ok:false,error:'method'},origin);
  if(!await authorize(req,res,['owner','dispatcher_logistic']))return;
  const chatId=safeId(req.query?.chat_id);
  const accountId=positiveId(req.query?.account_id);
  if(!chatId||!accountId)return reply(res,400,{ok:false,error:'fields'},origin);
  try{
    const result=await b2bhelp('/msg-center/chat/messages',{query:{chat_id:chatId,account_id:accountId,page:pageParam(req.query?.page,1,1000),limit:pageParam(req.query?.limit,50,50)}});
    return reply(res,200,{ok:true,result},origin);
  }catch(error){return sendError(res,error,origin)}
}
