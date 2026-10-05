const ALLOWED_ORIGINS=new Set(['https://araarkadij75-oss.github.io']);

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

  const lookup=await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
    {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({idToken})
    }
  );
  if(!lookup.ok){
    reply(res,401,{ok:false,error:'auth'},origin);
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

  const memberResponse=await fetch(memberUrl,{headers:{Authorization:`Bearer ${idToken}`}});
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
    token:Boolean(process.env.B2BHELP_API_TOKEN),
    apiContract:Boolean(process.env.B2BHELP_API_BASE_URL),
    webhookSecret:Boolean(process.env.B2BHELP_WEBHOOK_SECRET)
  };
}

export function integrationReady(){
  const c=configState();
  return c.token&&c.apiContract;
}

export function requireIntegrationConfig(res,origin=''){
  const c=configState();
  return reply(res,503,{
    ok:false,
    error:'b2bhelp_not_configured',
    configured:{token:c.token,apiContract:c.apiContract,webhookSecret:c.webhookSecret},
    message:'B2BHelp server secret and documented API base URL must be configured before upstream calls are enabled.'
  },origin);
}

export const safeId=value=>{
  const s=String(value||'');
  return /^[A-Za-z0-9_.:-]{1,240}$/.test(s)?s:'';
};

export const safeText=(value,max=4000)=>String(value??'').trim().slice(0,max);
