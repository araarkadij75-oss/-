const ALLOWED_ORIGINS=new Set(['https://araarkadij75-oss.github.io']);
let cachedToken='',tokenUntil=0;

export function reply(res,status,data,origin=''){
  if(ALLOWED_ORIGINS.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  return res.status(status).json(data);
}
export function preflight(req,res,methods='GET,POST,OPTIONS'){
  const origin=String(req.headers.origin||'');if(req.method!=='OPTIONS')return false;
  if(!ALLOWED_ORIGINS.has(origin))return reply(res,403,{ok:false},origin);
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods',methods);res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');res.setHeader('Vary','Origin');res.status(204).end();return true;
}
export async function authorize(req,res){
  const origin=String(req.headers.origin||'');if(!ALLOWED_ORIGINS.has(origin)){reply(res,403,{ok:false,error:'origin'},origin);return null}
  const idToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const key=process.env.FIREBASE_WEB_API_KEY;
  if(!key||!idToken){reply(res,401,{ok:false,error:'auth'},origin);return null}
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok){reply(res,401,{ok:false,error:'auth'},origin);return null}const data=await r.json();if(!data.users?.[0]){reply(res,401,{ok:false,error:'auth'},origin);return null}return{origin,user:data.users[0]};
}
async function token(){
  if(cachedToken&&Date.now()<tokenUntil)return cachedToken;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:process.env.AVITO_CLIENT_ID||'',client_secret:process.env.AVITO_CLIENT_SECRET||''});
  const r=await fetch('https://api.avito.ru/token/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error(`Avito auth ${r.status}`);
  const d=await r.json();cachedToken=d.access_token;tokenUntil=Date.now()+Math.max(60,(Number(d.expires_in)||3600)-120)*1000;return cachedToken;
}
export async function avito(path,options={}){const t=await token();const r=await fetch('https://api.avito.ru'+path,{...options,headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json','X-Source':'master-ai',...(options.headers||{})}});if(!r.ok)throw new Error(`Avito ${r.status}`);return r.status===204?{}:r.json()}
export const account=()=>String(process.env.AVITO_ACCOUNT_ID||'');
export const safeId=v=>{const s=String(v||'');return /^[A-Za-z0-9_-]{1,160}$/.test(s)?s:''};
