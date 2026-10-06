const ALLOWED_ORIGINS=new Set(
  String(process.env.CRM_ALLOWED_ORIGINS||'https://araarkadij75-oss.github.io')
    .split(',').map(value=>value.trim()).filter(Boolean)
);
export const B2BHELP_API_ORIGIN='https://dev.b2b-help.ru';

export function reply(res,status,data,origin=''){
  if(ALLOWED_ORIGINS.has(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(status).json(data);
}

export function preflight(req,res,methods='GET,POST,OPTIONS'){
  const origin=String(req.headers.origin||'');
  if(req.method!=='OPTIONS')return false;
  if(!ALLOWED_ORIGINS.has(origin))return reply(res,403,{ok:false,error:'origin'},origin);
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods',methods);
  res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');
  res.setHeader('Vary','Origin');
  res.status(204).end();
  return true;
}

export async function authorize(req,res,roles=['owner','dispatcher_logistic']){
  const origin=String(req.headers.origin||'');
  if(!ALLOWED_ORIGINS.has(origin)){
    reply(res,403,{ok:false,error:'origin'},origin);
    return null;
  }

  const idToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const key=process.env.FIREBASE_WEB_API_KEY;
  if(!key||!idToken){
    reply(res,401,{ok:false,error:'auth'},origin);
    return null;
  }

  let lookup;
  try{
    lookup=await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
      {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({idToken}),
        signal:AbortSignal.timeout(1800)
      }
    );
  }catch{
    reply(res,503,{ok:false,error:'auth_unavailable'},origin);
    return null;
  }
  if(!lookup.ok){
    const invalidToken=[400,401].includes(lookup.status);
    reply(res,invalidToken?401:503,{ok:false,error:invalidToken?'auth':'auth_unavailable'},origin);
    return null;
  }

  const data=await lookup.json();
  const user=data.users?.[0];
  if(!user){
    reply(res,401,{ok:false,error:'auth'},origin);
    return null;
  }

  const project=process.env.FIREBASE_PROJECT_ID||'master-ai-beta-9440599';
  const workspace=process.env.FIREBASE_WORKSPACE_ID||'master-ai-beta';
  const memberUrl=
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/workspaces/${encodeURIComponent(workspace)}/members/${encodeURIComponent(user.localId)}`;

  let memberResponse;
  try{
    memberResponse=await fetch(memberUrl,{headers:{Authorization:`Bearer ${idToken}`},signal:AbortSignal.timeout(1800)});
  }catch{
    reply(res,503,{ok:false,error:'membership_unavailable'},origin);
    return null;
  }
  if(!memberResponse.ok&&![403,404].includes(memberResponse.status)){
    reply(res,503,{ok:false,error:'membership_unavailable'},origin);
    return null;
  }
  const member=memberResponse.ok?await memberResponse.json():null;
  const role=member?.fields?.role?.stringValue||'';
  const active=member?.fields?.active?.booleanValue!==false;

  if(!active||!roles.includes(role)){
    reply(res,403,{ok:false,error:'role'},origin);
    return null;
  }
  return {origin,user,role};
}

export function configState(){
  return {
    token:Boolean(process.env.B2BHELP_API_TOKEN)
  };
}

export function integrationReady(){
  return configState().token;
}

export function requireIntegrationConfig(res,origin=''){
  const c=configState();
  return reply(res,503,{
    ok:false,
    error:'b2bhelp_not_configured',
    configured:c,
    message:'The B2BHelp API token must be configured on the server before upstream calls are enabled.'
  },origin);
}

export const safeId=value=>{
  const s=String(value??'').trim();
  return s.length>0&&s.length<=240&&!/[\u0000-\u001f\u007f]/.test(s)?s:'';
};

export const safeText=(value,max=4000)=>{
  const text=String(value??'').trim();
  return text.length>0&&text.length<=max?text:'';
};

export function pageParam(value,fallback,max=100){
  const raw=String(value??'');
  if(!/^[1-9]\d*$/.test(raw))return fallback;
  const n=Number(raw);
  return Number.isInteger(n)&&n>0?Math.min(n,max):fallback;
}

export function positiveId(value){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}

export async function b2bhelp(path,{method='GET',query,body}={}){
  if(!integrationReady())throw Object.assign(new Error('B2BHelp is not configured'),{status:503});
  if(!/^\/msg-center\/[A-Za-z0-9/_-]+$/.test(path))throw new TypeError('Invalid B2BHelp path');
  const url=new URL(path,B2BHELP_API_ORIGIN);
  if(query)for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  let response;
  try{
    response=await fetch(url,{method,headers:{Authorization:process.env.B2BHELP_API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
  }catch(error){
    throw Object.assign(new Error('B2BHelp is temporarily unavailable'),{status:502,cause:error});
  }
  let payload;
  try{payload=await response.json()}catch{payload=null}
  if(!response.ok||payload?.status===false){
    const upstreamStatus=response.status;
    throw Object.assign(new Error('B2BHelp request failed'),{status:upstreamStatus===401||upstreamStatus===403?502:upstreamStatus>=500?503:400,requestId:payload?.requestId||''});
  }
  if(payload&&Object.prototype.hasOwnProperty.call(payload,'result'))return payload.result??{};
  return payload??{};
}

export function sendError(res,error,origin=''){
  const status=Number(error?.status)||502;
  return reply(res,status,{ok:false,error:status===503?'upstream_unavailable':status===400?'upstream_rejected':'upstream',requestId:safeId(error?.requestId)||undefined},origin);
}
