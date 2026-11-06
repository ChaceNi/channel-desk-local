import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {definitions,validateDomain} from './config.mjs';

// No forwarded headers are used for identity, redirects, or cookie security.
export function cloudSettings(env=process.env){
 if(env.CHANNEL_DESK_CONFIG_FILE){
  let config;try{config=JSON.parse(readFileSync(env.CHANNEL_DESK_CONFIG_FILE,'utf8'));}catch{throw Error('服务器配置文件无法读取或 JSON 格式无效。');}
  const keys=['CHANNEL_DESK_PUBLIC_ORIGIN','SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET'];
  if(!config||typeof config!=='object'||Array.isArray(config)||keys.some(k=>typeof config[k]!=='string'))throw Error('服务器配置文件缺少必需字段。');
  env={...Object.fromEntries(keys.map(k=>[k,config[k]])),...env};
 }
 const origin=new URL(env.CHANNEL_DESK_PUBLIC_ORIGIN||'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('CHANNEL_DESK_PUBLIC_ORIGIN 必须为准确的 HTTPS 网站根地址。');
 const clientId=env.SHOPIFY_CLIENT_ID,clientSecret=env.SHOPIFY_CLIENT_SECRET;
 if(!clientId||!clientSecret||clientSecret.startsWith('@Microsoft.')||clientSecret.includes('REPLACE_'))throw Error('请通过服务端环境变量或受限配置文件提供 Shopify 应用凭据。');
 const stores=Object.fromEntries(definitions.map(d=>[d.id,{domain:d.defaultDomain,mode:'client_credentials',clientId,clientSecret}]));
 // Access is deliberately granted to verified reporting staff from either fixed shop.
 // Legacy CHANNEL_DESK_ALLOWED_USERS settings are not read.
 return {origin:origin.origin,clientId,clientSecret,stores};
}
export function validHmac(params,secret){
 if(new Set(params.keys()).size!==[...params.keys()].length)return false;
 const supplied=params.get('hmac')||'';if(!/^[a-f0-9]{64}$/.test(supplied))return false;
 const message=[...params].filter(([key])=>key!=='hmac').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('&');
 return timingSafeEqual(createHmac('sha256',secret).update(message).digest(),Buffer.from(supplied,'hex'));
}
const hash=v=>createHash('sha256').update(v).digest('hex');
const cookie=(name,value,seconds,sameSite='Strict')=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`;
const cookieValue=(req,name)=>String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
async function shopifyJSON(url,init){const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Shopify 身份验证失败。');return response.json();}
export function createCloudAccess({load=cloudSettings,transport=shopifyJSON,now=Date.now}={}){
 const pending=new Map(),sessions=new Map();
 const clean=()=>{for(const map of [pending,sessions])for(const [key,v] of map)if(v.expires<=now())map.delete(key);};
 async function verify(domain,token,shopId){const result=await transport(`https://${domain}/admin/api/2026-10/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:'query LoginShop { shop { id } }'})});if(result.errors?.length||result.data?.shop?.id!==`gid://shopify/Shop/${shopId}`)throw Error('店铺身份不符。');}
 return {
  async state(req){clean();load();const key=hash(cookieValue(req,'__Host-channel_session')),s=sessions.get(key);let authenticated=false;
   if(s)try{await verify(s.domain,s.token,s.shopId);authenticated=true;}catch{sessions.delete(key);}
   return {authenticated,canManageSettings:false,passwordConfigured:false,sharingEnabled:true,authMode:'shopify',accessPolicy:'reporting_staff_any_store',stores:definitions.map(d=>({id:d.id,label:d.label})),...(authenticated?{user:{shopId:s.shopId,userId:s.userId}}:{})};
  },
  async route(req,res,url){
   if(url.pathname==='/api/auth/login') {res.writeHead(405,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'请使用 Shopify 员工登录。'}));return true;}
   if(!['/auth/shopify/start','/auth/shopify/callback'].includes(url.pathname))return false;
   if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
   clean();const c=load();
   if(url.pathname.endsWith('/start')){
    const d=definitions.find(v=>v.id===url.searchParams.get('storeId'));if(!d)throw Error('请选择指定店铺。');if(pending.size>=1024)throw Error('登录请求繁忙，请稍后再试。');
    const nonce=randomBytes(32).toString('hex');pending.set(hash(nonce),{shopId:d.id,domain:d.authDomain||d.defaultDomain,expires:now()+10*60*1000});
    const target=new URL(`https://${d.authDomain||d.defaultDomain}/admin/oauth/authorize`);target.search=new URLSearchParams({client_id:c.clientId,scope:'read_reports,read_orders',redirect_uri:c.origin+'/auth/shopify/callback',state:nonce,'grant_options[]':'per-user'}).toString();
    res.writeHead(302,{'Set-Cookie':cookie('__Host-channel_oauth',nonce,600,'Lax'),Location:target.href});res.end();return true;
   }
   const params=url.searchParams,nonce=params.get('state')||'',key=hash(nonce),p=pending.get(key);pending.delete(key);
   // State is single use, bound to this browser and the selected known shop.
   if(!p||p.expires<=now()||cookieValue(req,'__Host-channel_oauth')!==nonce||!validHmac(params,c.clientSecret)||params.get('shop')!==p.domain||Math.abs(now()/1000-Number(params.get('timestamp')))>600||!/^\d+$/.test(params.get('timestamp')||'')||!params.get('code'))throw Error('Shopify 登录校验失败，请重新登录。');
   validateDomain(p.domain);
   const token=await transport(`https://${p.domain}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,code:params.get('code')}).toString()});
   const id=token.associated_user?.id;
   if(!token.access_token||!Number.isSafeInteger(id)||id<=0||!String(token.associated_user_scope||'').split(',').map(v=>v.trim()).includes('read_reports')||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw Error('需要有效的 Shopify 员工及报表读取权限。');
   const session={shopId:p.shopId,userId:String(id),domain:p.domain,token:token.access_token,expires:now()+Math.min(token.expires_in,8*3600)*1000};
   await verify(p.domain,session.token,p.shopId);if(sessions.size>=1024)throw Error('登录人数已达上限，请稍后再试。');
   const value=randomBytes(32).toString('hex');sessions.set(hash(value),session);
   res.writeHead(303,{'Set-Cookie':[cookie('__Host-channel_session',value,Math.min(token.expires_in,8*3600)),cookie('__Host-channel_oauth','',0,'Lax')],Location:'/'});res.end();return true;
  },
  logout(req){sessions.delete(hash(cookieValue(req,'__Host-channel_session')));return cookie('__Host-channel_session','',0);},
 };
}
