import {readFile,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {directory,ROOT} from '../server/config.mjs';
const recordFile=path.join(directory,'service.json');let record;try{record=JSON.parse(await readFile(recordFile,'utf8'));}catch(error){if(error.code==='ENOENT'){console.log('未发现此启动脚本管理的看板进程。');process.exit(0);}throw error;}
if(!Number.isInteger(record.pid)||record.pid<=1||record.entry!==path.join(ROOT,'server/index.mjs')||typeof record.node!=='string')throw Error('服务进程记录无效，未停止任何进程。');
let command;try{command=(await promisify(execFile)('/bin/ps',['-p',String(record.pid),'-o','command='])).stdout.trim();}catch{await unlink(recordFile);console.log('看板已停止。');process.exit(0);}
if(command!==`${record.node} ${record.entry}`)throw Error('进程已变化，未停止任何进程。');
process.kill(record.pid,'SIGTERM');for(let i=0;i<30;i++){try{process.kill(record.pid,0);await new Promise(r=>setTimeout(r,100));}catch{break;}}await unlink(recordFile);console.log('看板已停止。');
