import {reply,preflight,authorize,configState} from './_lib.mjs';

export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(preflight(req,res,'GET,OPTIONS'))return;
  if(req.method!=='GET')return reply(res,405,{ok:false,error:'method'},origin);
  if(!await authorize(req,res,['owner','dispatcher_logistic']))return;

  const c=configState();
  return reply(res,200,{
    ok:true,
    integration:'b2bhelp-message-center',
    directAvito:false,
    configured:{
      token:c.token,
      apiContract:c.apiContract,
      webhookSecret:c.webhookSecret
    }
  },origin);
}
