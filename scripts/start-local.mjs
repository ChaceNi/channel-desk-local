import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readAccess} from '../server/auth.mjs';
import {directory} from '../server/config.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {lanInterfaces} from '../server/network.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||5188);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT 无效。');
const url=`http://127.0.0.1:${port}`;
async function ready(){try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});const health=await response.json();return response.ok&&health.service==='channel-desk-local'&&health.version===2;}catch{return false;}}
if(!await ready()){const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,detached:true,stdio:'ignore',env:process.env});child.unref();await mkdir(directory,{recursive:true,mode:0o700});await writeFile(path.join(directory,'service.json'),JSON.stringify({pid:child.pid,node:process.execPath,entry:path.join(root,'server/index.mjs')})+'\n',{mode:0o600});for(let i=0;i<30&&!await ready();i++)await new Promise(r=>setTimeout(r,100));if(!await ready())throw Error('服务未启动，请使用 npm start 查看端口或运行错误。');}
console.log(`本机看板：${url}`);
if((await readAccess())?.sharingEnabled)for(const nic of lanInterfaces())console.log(`同事访问：http://${nic.address}:${port}/（需共享密码）`);
