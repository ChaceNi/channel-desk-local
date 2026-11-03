import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,rename,chmod,lstat} from 'node:fs/promises';
import path from 'node:path';
import {directory} from './config.mjs';
const scrypt=promisify(scryptCallback),cookieName='channel_desk_session',ttl=8*60*60*1000;
export async function readAccess(file=path.join(directory,'access.json')){try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('invalid');const value=JSON.parse(await readFile(file,'utf8'));if(value.version!==1||!/^([a-f0-9]{64})$/.test(value.salt)||!/^([a-f0-9]{128})$/.test(value.hash)||!/^([a-f0-9]{32})$/.test(value.revision))throw Error('invalid');return value;}catch(error){if(error.code==='ENOENT')return null;throw Error('共享访问配置无效，请在本机重新设置密码。');}}
export async function setAccessPassword(password,file=path.join(directory,'access.json')){if(typeof password!=='string'||password.length<6||password.length>128||/[\r\n]/.test(password))throw Error('密码需为 6–128 位，不能包含换行。');const salt=randomBytes(32).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');const value={version:1,salt,hash,revision:randomBytes(16).toString('hex'),sharingEnabled:true};const dir=path.dirname(file);await mkdir(dir,{recursive:true,mode:0o700});if((await lstat(dir)).isSymbolicLink())throw Error('密码目录不能为符号链接。');await chmod(dir,0o700);const temp=path.join(dir,`.access-${randomBytes(12).toString('hex')}.tmp`);await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);return value;}
function tokenFrom(req){const raw=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1);return raw&&/^[a-f0-9]{64}$/.test(raw)?raw:null;}
const digest=(value)=>createHash('sha256').update(value).digest('hex');
export function createAccessControl({load=readAccess,now=Date.now}={}){const sessions=new Map(),attempts=new Map();let activeChecks=0;
 const clean=()=>{const time=now();for(const [k,v] of sessions)if(v.expires<=time)sessions.delete(k);for(const [k,v] of attempts)if(v.until<=time)attempts.delete(k);};
 return {
  async state(req,{local=false}={}){const access=await load();if(!access)return {authenticated:local,passwordConfigured:false,canManageSettings:local,sharingEnabled:false};const token=tokenFrom(req),session=token&&sessions.get(digest(token));const authenticated=!!session&&session.expires>now()&&session.revision===access.revision;if(session&&!authenticated)sessions.delete(digest(token));return {authenticated,passwordConfigured:true,canManageSettings:authenticated&&local,sharingEnabled:access.sharingEnabled===true};},
  async login(req,password){clean();const access=await load();if(!access)return {status:503,body:{ok:false,message:'请先在服务电脑上设置共享密码。'}};const key=String(req.socket.remoteAddress||'unknown'),record=attempts.get(key);if(record?.count>=8&&record.until>now())return {status:429,body:{ok:false,message:'登录尝试过多，请在 15 分钟后再试。'}};if(activeChecks>=2)return {status:429,body:{ok:false,message:'登录验证繁忙，请稍后再试。'}};
   if(attempts.size>=2048&&!record)return {status:429,body:{ok:false,message:'登录验证繁忙，请稍后再试。'}};
   activeChecks++;let valid=false;try{if(typeof password==='string'&&password.length>=6&&password.length<=128){const hash=await scrypt(password,access.salt,64);valid=timingSafeEqual(hash,Buffer.from(access.hash,'hex'));}}finally{activeChecks--;}
   if(!valid){const current=attempts.get(key);attempts.set(key,{count:(current?.count||0)+1,until:current?.until||now()+15*60*1000});return {status:401,body:{ok:false,message:'密码不正确。'}};}
   attempts.delete(key);if(sessions.size>=1024)sessions.delete(sessions.keys().next().value);const token=randomBytes(32).toString('hex');sessions.set(digest(token),{revision:access.revision,expires:now()+ttl});return {status:200,cookie:`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl/1000}${req.socket.encrypted?'; Secure':''}`,body:{ok:true}};
  },
  logout(req){const token=tokenFrom(req);if(token)sessions.delete(digest(token));return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
 };
}
