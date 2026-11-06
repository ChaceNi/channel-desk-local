import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';

for(const deploymentMode of ['azure','production'])test(deploymentMode+' HTTP boundary: HTTPS proxy, exact Host, private setup blocked, OAuth callback exception only',async()=>{
 const child=spawn(process.execPath,['--input-type=module','-e',"import {createServer} from './server/index.mjs';const server=createServer(5203);server.listen(0,'127.0.0.1',()=>console.log('READY '+server.address().port));"],{cwd:new URL('..',import.meta.url),env:{...process.env,CHANNEL_DESK_MODE:deploymentMode,NODE_ENV:'production',CHANNEL_DESK_PUBLIC_ORIGIN:'https://dashboard.example.com',SHOPIFY_CLIENT_ID:'test-only-client',SHOPIFY_CLIENT_SECRET:'test-only-secret'},stdio:['ignore','pipe','pipe']});
 let startup='';const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',chunk=>{startup+=chunk;const match=startup.match(/READY (\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('startup exited '+code));});});
 function request(route,{method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{Host:'dashboard.example.com','X-Forwarded-Proto':'https',...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});}
 try{
  const health=await request('/api/health');assert.equal(health.status,200);assert.equal(JSON.parse(health.text).release.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
  assert.equal((await request('/api/auth/session',{headers:{Host:'evil.example.com'}})).status,403);
  assert.equal((await request('/api/auth/session',{headers:{'X-Forwarded-Proto':'http'}})).status,403);
  const s=await request('/api/auth/session');assert.equal(JSON.parse(s.text).authMode,'shopify');assert.equal(JSON.parse(s.text).accessPolicy,'reporting_staff_any_store');assert.equal(JSON.parse(s.text).authenticated,false);assert.ok(!s.text.includes('test-only-secret'));
  assert.equal((await request('/api/dashboard',{method:'POST',headers:{Origin:'https://dashboard.example.com','Content-Type':'application/json'},body:'{}'})).status,401);
  for(const route of ['/setup','/api/local/settings','/api/local/verify'])assert.equal((await request(route)).status,403);
  assert.equal((await request('/api/auth/login',{method:'POST',headers:{Origin:'https://dashboard.example.com','Content-Type':'application/json'},body:'{}'})).status,405);
  assert.equal((await request('/api/auth/logout',{method:'POST',headers:{Origin:'https://evil.example.com','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await request('/.private/stores.json')).status,404);
  const login=await request('/auth/shopify/start?storeId=65380483281');assert.equal(login.status,302);assert.ok(login.headers.location.startsWith('https://lakeside-asc.myshopify.com/admin/oauth/authorize?'));
  const callback=await request('/auth/shopify/callback?shop=attacker.myshopify.com&state=invalid',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(callback.status,400);assert.match(callback.text,/校验失败/);
  assert.equal((await request('/',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}})).status,200);
 }finally{child.kill('SIGTERM');await once(child,'exit');}
});
