import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const version=JSON.parse(readFileSync(new URL('package.json',root),'utf8')).version;
let generated={};
try{generated=JSON.parse(readFileSync(new URL('release-info.json',root),'utf8'));}catch{}
export const releaseInfo=Object.freeze({version,commit:/^[a-f0-9]{40,64}$/.test(generated.commit||'')?generated.commit:null,dirty:generated.dirty===true,builtAt:generated.builtAt||null});
