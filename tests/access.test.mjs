import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const privateDir=await mkdtemp(path.join(os.tmpdir(),'channel-access-test-'));
process.env.CHANNEL_DESK_PRIVATE_DIR=privateDir;
const {setAccessPassword,readAccess,createAccessControl}=await import('../server/auth.mjs');
const {allowedPeer,allowedHost}=await import('../server/network.mjs');
const {createServer}=await import('../server/index.mjs');
const fakePassword='testing-password-only';
const ownerReq=(cookie='')=>({headers:{cookie},socket:{remoteAddress:'127.0.0.1'}});
const cookieOf=result=>result.cookie.split(';')[0];
test('password is stored as salted hash with private permissions, never as plaintext',async()=>{const file=path.join(privateDir,'hash-test.json');const a=await setAccessPassword(fakePassword,file);const b=await setAccessPassword(fakePassword,file);assert.notEqual(a.hash,b.hash);assert.notEqual(a.salt,b.salt);assert.ok(!(await readFile(file,'utf8')).includes(fakePassword));assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await readAccess(file)).hash,b.hash);});
test('cookie authentication requires correct password; logout and expiry invalidate sessions',async()=>{let time=1000;const config=await setAccessPassword(fakePassword,path.join(privateDir,'session-test.json'));const access=createAccessControl({load:async()=>config,now:()=>time});assert.equal((await access.state(ownerReq())).authenticated,false);assert.equal((await access.login(ownerReq(),'incorrect-password')).status,401);const result=await access.login(ownerReq(),fakePassword);assert.equal(result.status,200);assert.match(result.cookie,/HttpOnly/);assert.match(result.cookie,/SameSite=Strict/);const req=ownerReq(cookieOf(result));assert.equal((await access.state(req,{local:true})).canManageSettings,true);assert.equal((await access.state(req,{local:false})).canManageSettings,false);access.logout(req);assert.equal((await access.state(req)).authenticated,false);const second=await access.login(ownerReq(),fakePassword);time+=8*60*60*1000+1;assert.equal((await access.state(ownerReq(cookieOf(second)))).authenticated,false);});
test('password change immediately invalidates existing login cookies',async()=>{const file=path.join(privateDir,'rotation-test.json');let config=await setAccessPassword(fakePassword,file);const access=createAccessControl({load:async()=>config});const result=await access.login(ownerReq(),fakePassword);const req=ownerReq(cookieOf(result));assert.equal((await access.state(req)).authenticated,true);config=await setAccessPassword('new-testing-password',file);assert.equal((await access.state(req)).authenticated,false);});
test('failed password attempts are limited by socket peer, including spoofed forwarded headers',async()=>{const config=await setAccessPassword(fakePassword,path.join(privateDir,'rate-test.json'));const access=createAccessControl({load:async()=>config});for(let n=0;n<8;n++){const req=ownerReq();req.headers['x-forwarded-for']='192.168.50.'+n;assert.equal((await access.login(req,'incorrect-password')).status,401);}assert.equal((await access.login(ownerReq(),fakePassword)).status,429);});
test('network boundary allows only current subnet and exact configured hosts',()=>{const interfaces=[{address:'192.168.50.23',netmask:'255.255.254.0'}];assert.equal(allowedPeer('192.168.50.5',interfaces),true);assert.equal(allowedPeer('192.168.51.9',interfaces),true);assert.equal(allowedPeer('192.168.52.9',interfaces),false);assert.equal(allowedPeer('10.1.1.1',interfaces),false);assert.equal(allowedPeer('8.8.8.8',interfaces),false);assert.equal(allowedHost('evil.test:5201',5201,interfaces),false);assert.equal(allowedHost('192.168.50.23:5201',5201,interfaces),true);});
test('HTTP gate protects reports; LAN readers cannot inspect or modify Shopify credentials',async()=>{await setAccessPassword(fakePassword);const interfaces=[{address:'192.168.50.23',netmask:'255.255.254.0'}];const server=createServer(5201,{interfaces,access:createAccessControl()});await new Promise(r=>server.listen(5201,'127.0.0.1',r));
 function request(route,{host='127.0.0.1:5201',method='GET',body,cookie,origin,extra={}}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:5201,path:route,method,headers:{Host:host,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{}),...extra}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});}
 try{
  assert.equal((await request('/api/dashboard',{method:'POST',body:{kind:'daily'},origin:'http://127.0.0.1:5201'})).status,401);
  assert.equal((await request('/api/local/settings')).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{password:fakePassword}})).status,403);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{password:fakePassword},origin:'https://evil.test'})).status,403);
  const login=await request('/api/auth/login',{method:'POST',body:{password:fakePassword},origin:'http://127.0.0.1:5201'});assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0].split(';')[0];
  assert.equal(JSON.parse((await request('/api/auth/session',{cookie})).body).canManageSettings,true);
  const remote={host:'192.168.50.23:5201',cookie};assert.equal(JSON.parse((await request('/api/auth/session',remote)).body).canManageSettings,false);
  for(const route of ['/setup','/api/local/settings','/api/local/verify'])assert.equal((await request(route,{...remote,extra:{'x-forwarded-for':'127.0.0.1'}})).status,403);
  assert.equal((await request('/api/local/settings',{...remote,method:'POST',body:{storeId:'65380483281'},origin:'http://192.168.50.23:5201'})).status,403);
  assert.equal((await request('/api/dashboard',{...remote,method:'POST',body:{kind:'invalid-test-kind'},origin:'http://192.168.50.23:5201'})).status,400);
  assert.equal((await request('/api/dashboard',{...remote,method:'POST',body:{kind:'invalid-test-kind'},origin:'http://127.0.0.1:5201'})).status,403);
  assert.equal((await request('/.private/access.json',{cookie})).status,404);
  assert.equal((await request('/.private/stores.json',{cookie})).status,404);
  const logout=await request('/api/auth/logout',{cookie,method:'POST',body:{},origin:'http://127.0.0.1:5201'});assert.equal(logout.status,200);assert.equal((await request('/api/dashboard',{cookie,method:'POST',body:{kind:'daily'},origin:'http://127.0.0.1:5201'})).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
