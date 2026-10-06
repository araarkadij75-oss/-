import {reply,preflight,authorize,pageParam,b2bhelp,sendError} from './_lib.mjs';

export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(preflight(req,res,'GET,OPTIONS'))return;
  if(req.method!=='GET')return reply(res,405,{ok:false,error:'method'},origin);
  if(!await authorize(req,res,['owner','dispatcher_logistic']))return;
  try{
    const chats=await b2bhelp('/msg-center/chats',{query:{page:pageParam(req.query?.page,1,1000),limit:pageParam(req.query?.limit,50,50)}});
    return reply(res,200,{ok:true,chats:Array.isArray(chats)?chats:[]},origin);
  }catch(error){return sendError(res,error,origin)}
}
