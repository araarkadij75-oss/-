import {reply,preflight,authorize,positiveId,safeId,safeText,b2bhelp,sendError} from './_lib.mjs';

export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(preflight(req,res,'POST,OPTIONS'))return;
  if(req.method!=='POST')return reply(res,405,{ok:false,error:'method'},origin);
  if(!await authorize(req,res,['owner','dispatcher_logistic']))return;
  const chatId=safeId(req.body?.chat_id);
  const accountId=positiveId(req.body?.account_id);
  const text=safeText(req.body?.text,1000);
  if(!chatId||!accountId||!text)return reply(res,400,{ok:false,error:'fields'},origin);
  try{
    const result=await b2bhelp('/msg-center/chat/messsage/send',{method:'POST',body:{account_id:accountId,chat_id:chatId,text}});
    return reply(res,200,{ok:true,result},origin);
  }catch(error){return sendError(res,error,origin)}
}
