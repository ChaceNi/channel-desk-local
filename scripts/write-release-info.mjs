import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const {version}=JSON.parse(await readFile('package.json','utf8'));
let commit=null,dirty=true;
try{
 commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 dirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()!=='';
}catch{}
if(process.env.CHANNEL_DESK_BUILD_COMMIT){
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(process.env.CHANNEL_DESK_BUILD_COMMIT))throw Error('Build commit must be a full Git SHA.');
 commit=process.env.CHANNEL_DESK_BUILD_COMMIT;dirty=process.env.CHANNEL_DESK_BUILD_DIRTY!=='false';
}
await writeFile('release-info.json',JSON.stringify({version,commit,dirty,builtAt:new Date().toISOString()},null,2)+'\n');
