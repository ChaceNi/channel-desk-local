import http from 'node:http';
import {releaseInfo} from './release-info.mjs';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,saveStore,publicConfig} from './config.mjs';
import {verifyStore} from './shopify.mjs';
import {POST} from './report-route.js';
import {createAccessControl,readAccess} from './auth.mjs';
import {lanInterfaces,allowedPeer,allowedHost,localOwnerRequest} from './network.mjs';
import {cloudSettings,createCloudAccess} from './cloud.mjs';
const cloud=['production','azure'].includes(process.env.CHANNEL_DESK_MODE);
if(process.env.CHANNEL_DESK_MODE&&!['local','production','azure'].includes(process.env.CHANNEL_DESK_MODE))throw Error('CHANNEL_DESK_MODE 无效。');
// Never let a production deployment silently fall back to unauthenticated local mode.
if((process.env.WEBSITE_SITE_NAME||process.env.NODE_ENV==='production')&&!cloud)throw Error('正式部署必须显式配置 CHANNEL_DESK_MODE=production（兼容 azure）。');
const cloudConfig=cloud?cloudSettings():null;
const sharedAccess=cloud?createCloudAccess():createAccessControl();
export function createServer(port,{access=sharedAccess,interfaces=lanInterfaces()}={}){const origin=`http://127.0.0.1:${port}`;return http.createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
 // Platform health probes return only a constant; never inspect sessions or configuration.
 if(cloud&&req.method==='GET'&&req.url==='/api/health')return send(200,{service:'channel-desk-local',version:2,release:releaseInfo});
 if(cloud?req.headers.host!==new URL(cloudConfig.origin).host:(!allowedPeer(req.socket.remoteAddress,interfaces)||!allowedHost(req.headers.host,port,interfaces)))return send(403,{message:cloud?'网站域名不匹配。':'仅允许本机及公司同网段访问。'});
 const expectedOrigin=cloud?cloudConfig.origin:`http://${req.headers.host}`;
 if(cloud){res.setHeader('Strict-Transport-Security','max-age=31536000');if(req.headers['x-forwarded-proto']!=='https')return send(403,{message:'正式部署仅允许可信 HTTPS 代理入口。'});}
 const oauthCallback=cloud&&req.method==='GET'&&req.url?.startsWith('/auth/shopify/callback?');
 const landingNavigation=cloud&&req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'&&['/','/login'].includes(req.url?.split('?')[0]);
 if(!oauthCallback&&!landingNavigation&&((req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))||(req.headers.origin&&req.headers.origin!==expectedOrigin)))return send(403,{message:'禁止跨站访问看板。'});
 const url=new URL(req.url,origin),local=!cloud&&localOwnerRequest(req,port);
 try{
  if(req.method==='GET'&&url.pathname==='/api/health')return send(200,{service:'channel-desk-local',version:2,release:releaseInfo});
  if(cloud&&(url.pathname.startsWith('/api/local/')||url.pathname==='/setup'))return send(403,{message:'云端禁止通过网页管理凭据。请由管理员在服务器配置。'});
  if(cloud&&await access.route(req,res,url))return;
  const auth=await access.state(req,{local});
  if(!local&&!auth.sharingEnabled)return send(403,{message:'尚未开启内网共享，请在服务电脑上设置密码。'});
  if(req.method==='GET'&&url.pathname==='/api/auth/session')return send(200,auth);
  if((url.pathname.startsWith('/api/local/')||url.pathname==='/setup')&&!local)return send(403,{message:'Shopify 凭据仅允许在服务电脑通过本机地址管理。'});
  if(url.pathname.startsWith('/api/')){
   if(!['/api/auth/login','/api/auth/logout'].includes(url.pathname)&&!auth.authenticated)return send(401,{status:'login_required',message:cloud?'请先使用获准的 Shopify 员工账号登录。':'请先输入共享访问密码。'});
   if(req.method==='GET'&&url.pathname==='/api/local/settings')return send(200,{stores:await publicConfig(),localOnly:true});
   if(req.method!=='POST'||req.headers.origin!==expectedOrigin||!/^application\/json(?:;|$)/.test(req.headers['content-type']||''))return send(403,{message:'仅支持同源 JSON 请求。'});
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>65536)return send(413,{message:'请求体过大。'});chunks.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{message:'JSON 格式无效。'});}if(!input||typeof input!=='object'||Array.isArray(input))return send(400,{message:'请求参数无效。'});
   if(url.pathname==='/api/auth/login'){const result=await access.login(req,input.password);if(result.cookie)res.setHeader('Set-Cookie',result.cookie);return send(result.status,result.body);}
   if(url.pathname==='/api/auth/logout'){res.setHeader('Set-Cookie',access.logout(req));return send(200,{ok:true});}
   if(url.pathname==='/api/local/settings'){await saveStore(input);return send(200,{ok:true,stores:await publicConfig()});}
   if(url.pathname==='/api/local/verify'){const shop=await verifyStore(input.storeId);return send(200,{ok:true,shop});}
   if(url.pathname==='/api/dashboard'){const response=await POST(new Request(origin+url.pathname,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(input)}));res.writeHead(response.status,{'Content-Type':'application/json'});return res.end(await response.text());}
   return send(404,{message:'接口不存在。'});
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{message:'Method not allowed'});
  const relative=(url.pathname==='/'||url.pathname==='/setup'||url.pathname==='/login')?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');const target=path.resolve(ROOT,'dist',relative),base=path.join(ROOT,'dist')+path.sep;if(!target.startsWith(base))return send(404,{message:'Not found'});
  let metadata;try{metadata=await stat(target);}catch{return send(404,{message:'Not found'});}if(!metadata.isFile())return send(404,{message:'Not found'});
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(target)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});res.end(req.method==='HEAD'?undefined:await readFile(target));
 }catch(error){send(400,{ok:false,message:cloud?(url.pathname.startsWith('/auth/')?error.message:'服务暂时不可用，请联系管理员检查配置。'):(error.message||'本地服务暂时不可用。')});}
});}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const port=Number(process.env.PORT||5188);if(!Number.isInteger(port)||port<(cloud?1:1024)||port>65535)throw Error('PORT 无效。');const configured=cloud?null:await readAccess(),interfaces=cloud?[]:lanInterfaces();const addresses=cloud?['0.0.0.0']:['127.0.0.1',...(configured?.sharingEnabled?interfaces.map(n=>n.address):[])];
 const servers=[];for(const address of new Set(addresses)){const server=createServer(port,{interfaces});server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`地址 ${address}:${port} 已被占用，请检查旧实例。`:`无法监听 ${address}:${port}。`);for(const active of servers)active.close();process.exitCode=1;});server.listen(port,address,()=>cloud?console.log('Channel Desk production server ready.'):console.log(`Channel Desk：http://${address}:${port}${address==='127.0.0.1'?'（本机管理）':'（公司内网，需密码）'}`));servers.push(server);}
}
