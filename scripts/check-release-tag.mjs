import {readFile} from 'node:fs/promises';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const tag=process.argv[2];
if(!tag||tag!==`v${version}`)throw Error(`发布标签必须与 package.json 版本一致：v${version}`);
console.log('Release tag matches package version.');
