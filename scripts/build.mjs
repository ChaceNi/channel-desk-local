import {readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
import {build} from 'vite';
for(const name of ['lib/dashboard','lib/queries','lib/shopify-report-scope','server/report-route']){const code=await readFile(name+'.ts','utf8');await writeFile(name+'.js',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)}
await build();
