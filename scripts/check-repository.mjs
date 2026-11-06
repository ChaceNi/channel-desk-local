import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const directories=['src','server','lib','scripts','tests','deploy','.github'];
let files;
try{files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);}catch{
 const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(directory,item.name)):item.isFile()?[path.join(directory,item.name)]:[]);
 files=directories.flatMap(walk);
}
for(const file of files){
 if(file.split('/').some(part=>['.private','node_modules','.azure','stores.json','access.json','allowed-users.json','service.json','runtime.config.json'].includes(part)||part.startsWith('.env'))||/\.(?:pem|key|pfx|p12|csv|xlsx|log|publishsettings)$/i.test(file))throw Error('禁止提交私有配置、凭据或业务导出文件：'+file);
 const body=readFileSync(file,'utf8');
 if(/(?:shpat_|shpss_|shpca_)[A-Za-z0-9]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body))throw Error('检测到可能的凭据：'+file);
}
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
for(const arch of ['x64','arm64'])for(const name of [`@rolldown/binding-linux-${arch}-gnu`,`@tailwindcss/oxide-linux-${arch}-gnu`,`lightningcss-linux-${arch}-gnu`]){
 if(!lock.packages?.['node_modules/'+name])throw Error('Lock file is missing a Linux build dependency: '+name);
}
console.log('Repository file boundary and credential-pattern checks passed.');
