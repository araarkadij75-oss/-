const ALLOWED_ORIGINS=new Set(['https://araarkadij75-oss.github.io']);
let cachedToken='',tokenUntil=0;

function json(res,status,data,origin=''){
  if(ALLOWED_ORIGINS.has(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(status).json(data);
}

async function verifyFirebase(idToken){
  const key=process.env.FIREBASE_WEB_API_KEY;
  if(!key||!idToken)return null;
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok)return null;
  const data=await r.json();
  return data.users?.[0]||null;
}

async function avitoToken(){
  if(cachedToken&&Date.now()<tokenUntil)return cachedToken;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:process.env.AVITO_CLIENT_ID||'',client_secret:process.env.AVITO_CLIENT_SECRET||''});
  const r=await fetch('https://api.avito.ru/token/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!r.ok)throw new Error(`Avito auth ${r.status}`);
  const data=await r.json();cachedToken=data.access_token;tokenUntil=Date.now()+Math.max(60,(Number(data.expires_in)||3600)-120)*1000;return cachedToken;
}

async function avito(path,options={}){
  const token=await avitoToken();
  const r=await fetch('https://api.avito.ru'+path,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Source':'master-ai',...(options.headers||{})}});
  if(!r.ok)throw new Error(`Avito ${path} ${r.status}`);
  return r.json();
}

export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(req.method==='OPTIONS'){
    if(!ALLOWED_ORIGINS.has(origin))return json(res,403,{ok:false},origin);
    res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization');return res.status(204).end();
  }
  if(req.method!=='GET')return json(res,405,{ok:false,error:'method'},origin);
  if(!ALLOWED_ORIGINS.has(origin))return json(res,403,{ok:false,error:'origin'},origin);
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const user=await verifyFirebase(bearer);
  if(!user)return json(res,401,{ok:false,error:'auth'},origin);
  try{
    const account=process.env.AVITO_ACCOUNT_ID;
    const sinceRaw=String(req.query?.since||'');
    const since=/^\d{4}-\d{2}-\d{2}T/.test(sinceRaw)?new Date(sinceRaw):new Date(Date.now()-24*3600e3);
    const safeSince=new Date(Math.max(since.getTime(),Date.now()-7*86400e3)).toISOString();
    const callsData=await avito('/cpa/v2/callsByTime',{method:'POST',body:JSON.stringify({dateTimeFrom:safeSince,limit:100,offset:0})});
    let chatsData={chats:[]};
    try{chatsData=await avito(`/messenger/v2/accounts/${encodeURIComponent(account)}/chats?unread_only=true&limit=100&offset=0`)}catch{}
    const calls=(callsData.calls||[]).map(c=>({id:`call:${c.id}`,kind:'call',externalId:String(c.id),phone:String(c.buyerPhone||''),itemId:String(c.itemId||''),createdAt:c.createTime||c.startTime||'',duration:Number(c.duration||0),recordUrl:c.recordUrl||'',title:c.groupTitle||'Звонок с Avito'}));
    const chats=(chatsData.chats||[]).map(c=>({id:`chat:${c.id}`,kind:'message',externalId:String(c.id),itemId:String(c.context?.value?.id||c.item_id||''),createdAt:c.updated||c.created||'',title:c.context?.value?.title||'Сообщение с Avito',preview:c.last_message?.content?.text||(c.last_message?.content?.voice?.voice_id?'Голосовое сообщение':'')}));
    return json(res,200,{ok:true,serverTime:new Date().toISOString(),calls,chats},origin);
  }catch(error){return json(res,502,{ok:false,error:'upstream',message:String(error.message||error)},origin)}
}
