import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {cloudSettings,validHmac,createCloudAccess} from '../server/cloud.mjs';
const secret='test-only-client-secret',shopId='65380483281',domain='lakeside-asc.myshopify.com';
const environment={CHANNEL_DESK_PUBLIC_ORIGIN:'https://dashboard.example.com',SHOPIFY_CLIENT_ID:'test-client-id',SHOPIFY_CLIENT_SECRET:secret};
const sign=p=>{p.set('hmac',createHmac('sha256',secret).update([...p].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('&')).digest('hex'));return p;};
const response=()=>({status:0,headers:{},writeHead(status,headers={}){this.status=status;this.headers=headers;},end(){}});
const req=(cookie='')=>({method:'GET',headers:{cookie}});
function fixture(options={}){
 let time=1000000,revoked=false,grants=0;
 const id=options.shopId||shopId,authDomain=id===shopId?domain:'et7vgr-3p.myshopify.com';
 const access=createCloudAccess({now:()=>time,load:()=>cloudSettings({...environment,CHANNEL_DESK_ALLOWED_USERS:'[]'}),transport:async(url)=>{
  assert.equal(new URL(url).hostname,authDomain);
  if(url.endsWith('access_token')){grants++;return {access_token:'online-test-token',...(options.noUser?{}:{associated_user:{id:options.userId??42}}),associated_user_scope:options.scopes??'read_reports,read_orders',expires_in:options.expires??3600};}
  if(revoked)throw Error('revoked');return {data:{shop:{id:'gid://shopify/Shop/'+(options.identityId||id)}}};
 }});
 return {access,id,authDomain,advance:()=>time+=3600001,revoke:()=>revoked=true,grants:()=>grants};
}
async function start(f){const res=response();await f.access.route(req(),res,new URL('https://dashboard.example.com/auth/shopify/start?storeId='+f.id));assert.equal(res.status,302);assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);assert.equal(new URL(res.headers.Location).searchParams.get('grant_options[]'),'per-user');const state=new URL(res.headers.Location).searchParams.get('state');return {state,cookie:res.headers['Set-Cookie'].split(';')[0]};}
function callback(state,shop=domain){return new URL('https://dashboard.example.com/auth/shopify/callback?'+sign(new URLSearchParams({shop,state,timestamp:'1000',code:'test-code'})));}
async function login(f){const s=await start(f),res=response();await f.access.route(req(s.cookie),res,callback(s.state,f.authDomain));assert.equal(res.status,303);assert.match(res.headers['Set-Cookie'][0],/Secure; SameSite=Strict/);return res.headers['Set-Cookie'][0].split(';')[0];}
test('cloud configuration requires HTTPS and real credentials, with no employee-list requirement',()=>{
 assert.throws(()=>cloudSettings({...environment,CHANNEL_DESK_PUBLIC_ORIGIN:'http://dashboard.example.com'}));
 assert.throws(()=>cloudSettings({...environment,SHOPIFY_CLIENT_SECRET:'@Microsoft.KeyVault(unresolved)'}));
 assert.equal(cloudSettings(environment).origin,'https://dashboard.example.com');
 assert.ok(!('allowlist' in cloudSettings({...environment,CHANNEL_DESK_ALLOWED_USERS:'invalid-old-configuration'})));
});
test('HMAC rejects tampering and duplicate query keys',()=>{const p=sign(new URLSearchParams({state:'abc',shop:domain}));assert.equal(validHmac(p,secret),true);p.append('shop',domain);assert.equal(validHmac(p,secret),false);p.delete('shop');assert.equal(validHmac(p,secret),false);});
test('OAuth is browser/shop bound, single use, and rejects unsigned requests before token exchange',async()=>{const f=fixture(),s=await start(f);await assert.rejects(f.access.route(req(),response(),callback(s.state)));assert.equal(f.grants(),0);await assert.rejects(f.access.route(req(s.cookie),response(),callback(s.state)));const s2=await start(f),url=callback(s2.state);url.searchParams.set('shop','attacker.myshopify.com');await assert.rejects(f.access.route(req(s2.cookie),response(),url));assert.equal(f.grants(),0);await assert.rejects(f.access.route(req(),response(),new URL('https://dashboard.example.com/auth/shopify/start?storeId=unknown')));});
test('verified reporting staff in either fixed store can log in despite absent or empty legacy lists',async()=>{
 for(const id of [shopId,'66814050502']){const f=fixture({shopId:id,userId:98765}),cookie=await login(f),state=await f.access.state(req(cookie));assert.equal(state.authenticated,true);assert.equal(state.accessPolicy,'reporting_staff_any_store');assert.deepEqual(state.user,{shopId:id,userId:'98765'});assert.equal(state.canManageSettings,false);}
});
test('customer-like identities, missing report scope and invalid online tokens cannot establish sessions',async()=>{
 for(const options of [{noUser:true},{userId:0},{scopes:'read_orders'},{expires:0}])await assert.rejects(login(fixture(options)),/有效的 Shopify 员工及报表读取权限/);
 const f=fixture();assert.equal((await f.access.state(req('__Host-channel_session=forged'))).authenticated,false);
});
test('staff sessions never expose tokens or manage settings; logout, expiry and Shopify revocation terminate access',async()=>{for(const action of ['logout','expire','revoke']){const f=fixture(),cookie=await login(f);const current=await f.access.state(req(cookie));assert.equal(current.authenticated,true);assert.equal(current.canManageSettings,false);assert.ok(!JSON.stringify(current).includes('online-test-token'));if(action==='logout')f.access.logout(req(cookie));if(action==='expire')f.advance();if(action==='revoke')f.revoke();assert.equal((await f.access.state(req(cookie))).authenticated,false);}});
test('LTD OAuth uses its exact observed authorization domain and still verifies immutable shop ID',async()=>{
 const good=fixture({shopId:'66814050502'});assert.equal((await good.access.state(req(await login(good)))).authenticated,true);
 await assert.rejects(login(fixture({shopId:'66814050502',identityId:shopId})),/店铺身份不符/);
});
