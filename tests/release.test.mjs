import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('release archives preserve CI configuration, version identity, executable shortcuts and exclude private state',()=>{
 execFileSync('python3',['scripts/package-release.py'],{stdio:'pipe'});
 const code=String.raw`
import zipfile,json,pathlib,hashlib
root=pathlib.Path('.')
manifest=json.loads((root/'release/release-manifest.json').read_text())
assert manifest['version']==json.loads((root/'package.json').read_text())['version']
for record in manifest['artifacts']:
 assert hashlib.sha256((root/'release'/record['file']).read_bytes()).hexdigest()==record['sha256']
with zipfile.ZipFile(root/'release/channel-desk-source.zip') as source:
 assert '.github/workflows/ci-release.yml' in source.namelist()
 assert '.github/workflows/deploy-server.yml' in source.namelist()
 assert not any('login-test' in name for name in source.namelist())
 assert '.github/workflows/deploy-azure.yml' not in source.namelist()
 assert '.node-version' in source.namelist()
 assert 'Dockerfile' in source.namelist() and '.dockerignore' in source.namelist()
 assert 'compose.yaml' in source.namelist()
 assert 'deploy/server/Caddyfile' in source.namelist()
 assert (source.getinfo('启动看板.command').external_attr>>16)&0o111
 assert all('.private' not in name and not name.startswith('node_modules/') for name in source.namelist())
with zipfile.ZipFile(root/'release/channel-desk-server.zip') as runtime:
 package=json.loads(runtime.read('package.json'))
 assert 'devDependencies' not in package and package['scripts']=={'start':'node server/index.mjs'}
 assert json.loads(runtime.read('release-info.json'))['version']==manifest['version']
 assert 'server/release-info.mjs' in runtime.namelist()
 assert not any(name.startswith(('.github/','.private/','src/')) for name in runtime.namelist())
 assert 'Dockerfile' in runtime.namelist() and 'compose.yaml' in runtime.namelist()
 assert 'deploy/server/manage.py' in runtime.namelist()
 assert 'deploy/server/setup.py' in runtime.namelist()
 assert b'AS build' not in runtime.read('Dockerfile')
 assert json.loads(runtime.read('release-info.json'))['version']==manifest['version']
`;
 assert.doesNotThrow(()=>execFileSync('python3',['-c',code],{stdio:'pipe'}));
});

test('archive guard rejects credential-shaped contents and unexpected hidden files',()=>{
 const code=String.raw`
import importlib.util
spec=importlib.util.spec_from_file_location('packaging','scripts/package-release.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.guard('.github/workflows/ci.yml',b'name: test')
for filename,content in [('.private/stores.json',b'{}'),('deploy/stores.json',b'{}'),('.github/.private/key',b'x'),('src/example.ts',b'shpat_'+b'a'*32)]:
 try: module.guard(filename,content)
 except ValueError: continue
 raise AssertionError('archive guard failed')
`;
 assert.doesNotThrow(()=>execFileSync('python3',['-c',code],{stdio:'pipe'}));
});
