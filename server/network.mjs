import os from 'node:os';
import {isIPv4} from 'node:net';
export const isLoopback=(ip)=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';
const normalize=(ip)=>String(ip||'').replace(/^::ffff:/,'');
const numeric=(ip)=>ip.split('.').reduce((n,part)=>(n*256+Number(part))>>>0,0);
export function isPrivateIPv4(ip){if(!isIPv4(ip))return false;const [a,b]=ip.split('.').map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);}
export function lanInterfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>(entries||[]).filter(v=>v.family==='IPv4'&&!v.internal&&isPrivateIPv4(v.address)).map(v=>({name,address:v.address,netmask:v.netmask})));}
export function allowedPeer(ip,interfaces){const source=normalize(ip);return isLoopback(source)||isPrivateIPv4(source)&&interfaces.some(n=>(numeric(source)&numeric(n.netmask))===(numeric(n.address)&numeric(n.netmask)));}
export function allowedHost(host,port,interfaces){return [`127.0.0.1:${port}`,`localhost:${port}`,...interfaces.map(n=>`${n.address}:${port}`)].includes(host);}
export function localOwnerRequest(req,port){return isLoopback(req.socket.remoteAddress)&&[`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host);}
