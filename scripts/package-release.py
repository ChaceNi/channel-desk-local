#!/usr/bin/env python3
"""Publish only approved source/runtime trees; never traverse private data or Git history."""
from pathlib import Path
import json, hashlib, zipfile, re
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'release'
SOURCE_DIRS = ['src','server','lib','scripts','tests','deploy']
SOURCE_FILES = ['package.json','package-lock.json','README.md','CHANGELOG.md','index.html','vite.config.ts','postcss.config.mjs','.gitignore','.node-version','Dockerfile','.dockerignore','compose.yaml','启动看板.command','设置访问密码.command','重启看板.command','停止看板.command']
def guard(name, data):
    pieces=Path(name).parts
    if any(part in {'stores.json','access.json','allowed-users.json','service.json','runtime.config.json'} for part in pieces):
        raise ValueError('Private configuration filename: '+name)
    for i,part in enumerate(pieces):
        if part.startswith('.') and not (i==0 and part in ['.gitignore','.node-version','.dockerignore']) and not (i==0 and part=='.github' and pieces[1:2]==('workflows',)):
            raise ValueError('Unexpected hidden path: '+name)
    if re.search(rb'(?:shpat_|shpss_|shpca_)[A-Za-z0-9]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',data):
        raise ValueError('Possible credential in '+name)
def archive(name, entries):
    target=OUT/name
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for filename,data in sorted(entries.items()):
            guard(filename,data)
            info=zipfile.ZipInfo(filename)
            info.create_system=3
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=(0o100755 if filename.endswith('.command') else 0o100644)<<16
            z.writestr(info,data)
    return target
def safe_bytes(file):
    if file.is_symlink(): raise ValueError('Refusing symlink: '+str(file.relative_to(ROOT)))
    return file.read_bytes()
def main():
    OUT.mkdir(exist_ok=True)
    source={name:safe_bytes(ROOT/name) for name in SOURCE_FILES}
    for directory in SOURCE_DIRS:
        for file in sorted((ROOT/directory).rglob('*')):
            if file.is_symlink(): raise ValueError('Refusing source symlink')
            if file.is_file() and file.suffix in {'.mjs','.ts','.tsx','.css','.json','.md','.py','.js','.sh'}:
                if file.name=='report-route.js' or (file.parent.name=='lib' and file.suffix=='.js'): continue
                source[str(file.relative_to(ROOT))]=safe_bytes(file)
    server_support=['deploy/server/setup.py','deploy/server/manage.py','deploy/server/smoke-container.sh','deploy/server/Caddyfile','deploy/server/Dockerfile.runtime','deploy/server/nginx.conf.example','deploy/server/runtime.config.example.json']
    for name in server_support:source[name]=safe_bytes(ROOT/name)
    for file in sorted((ROOT/'.github/workflows').glob('*.yml')):
        source[str(file.relative_to(ROOT))]=safe_bytes(file)
    runtime={}
    for directory in ['dist','server','lib']:
        for file in sorted((ROOT/directory).rglob('*')):
            if file.is_symlink(): raise ValueError('Refusing runtime symlink')
            if file.is_file() and (directory=='dist' or file.suffix in {'.mjs','.js'}):
                runtime[str(file.relative_to(ROOT))]=safe_bytes(file)
    assert 'dist/index.html' in runtime and 'server/report-route.js' in runtime,'Run npm run build first'
    manifest=json.loads((ROOT/'package.json').read_text())
    manifest['scripts']={'start':'node server/index.mjs'}
    manifest.pop('devDependencies',None)
    lock=json.loads((ROOT/'package-lock.json').read_text())
    lock['packages'][''].pop('devDependencies',None)
    runtime['package.json']=(json.dumps(manifest,indent=2)+'\n').encode()
    runtime['package-lock.json']=(json.dumps(lock,indent=2)+'\n').encode()
    release=json.loads((ROOT/'release-info.json').read_text())
    assert release['version']==manifest['version'],'Release metadata version mismatch'
    runtime['release-info.json']=safe_bytes(ROOT/'release-info.json')
    for file in (ROOT/'deploy').glob('*'):
        if file.is_file():runtime['deploy/'+file.name]=safe_bytes(file)
    runtime['README.md']=b'See deploy/DEPLOY-SERVER.md. Prebuilt runtime: npm ci --omit=dev then npm start.\n'
    server_runtime={**runtime,'Dockerfile':safe_bytes(ROOT/'deploy/server/Dockerfile.runtime'),'.dockerignore':safe_bytes(ROOT/'.dockerignore'),'compose.yaml':safe_bytes(ROOT/'compose.yaml')}
    for name in server_support:server_runtime[name]=safe_bytes(ROOT/name)
    outputs=[archive('channel-desk-source.zip',source),archive('channel-desk-server.zip',server_runtime)]
    published={**release,'artifacts':[{'file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size} for file in outputs]}
    release_file=OUT/'release-manifest.json'
    release_file.write_text(json.dumps(published,indent=2)+'\n')
    outputs.append(release_file)
    (OUT/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name+'\n' for file in outputs))
    print('Created v'+manifest['version']+' source/runtime archives and release manifest; private configuration excluded.')
if __name__=='__main__':main()
