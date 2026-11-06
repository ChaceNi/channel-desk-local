import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {cloudSettings} from '../server/cloud.mjs';

test('production credentials load from a mounted config file without being present in process environment',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'channel-server-config-'));
 const file=path.join(directory,'runtime.config.json');
 const config={CHANNEL_DESK_PUBLIC_ORIGIN:'https://server.example.com',SHOPIFY_CLIENT_ID:'file-id',SHOPIFY_CLIENT_SECRET:'file-only-secret'};
 try{
  writeFileSync(file,JSON.stringify(config),{mode:0o600});
  const result=cloudSettings({CHANNEL_DESK_CONFIG_FILE:file});
  assert.equal(result.origin,config.CHANNEL_DESK_PUBLIC_ORIGIN);assert.equal(result.clientSecret,'file-only-secret');
  assert.equal(cloudSettings({CHANNEL_DESK_CONFIG_FILE:file,SHOPIFY_CLIENT_SECRET:'environment-override'}).clientSecret,'environment-override');
  writeFileSync(file,'not-json');assert.throws(()=>cloudSettings({CHANNEL_DESK_CONFIG_FILE:file}),/JSON/);
  writeFileSync(file,'[]');assert.throws(()=>cloudSettings({CHANNEL_DESK_CONFIG_FILE:file}),/必需字段/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('server deploy preflight rejects insecure configs and never exports the secret to Compose',()=>{
 const code=String.raw`
import importlib.util,tempfile,pathlib,json,os
spec=importlib.util.spec_from_file_location('deploy_server','deploy/server/manage.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as d:
 file=pathlib.Path(d)/'runtime.config.json';data={'CHANNEL_DESK_PUBLIC_ORIGIN':'https://server.example.com','SHOPIFY_CLIENT_ID':'test-id','SHOPIFY_CLIENT_SECRET':'secret-kept-in-file'}
 file.write_text(json.dumps(data));file.chmod(0o644)
 try: module.settings(str(file),5188,'caddy')
 except ValueError: pass
 else: raise AssertionError('world-readable config allowed')
 file.chmod(0o600)
 if os.getuid()==0:os.chown(file,1000,1000)
 record=module.settings(str(file),5188,'caddy');record['image']='channel-desk:test'
 assert record['domain']=='server.example.com' and record['uid']!=0
 assert 'secret-kept-in-file' not in json.dumps(module.environment(record))
 data['CHANNEL_DESK_PUBLIC_ORIGIN']='http://server.example.com';file.write_text(json.dumps(data))
 try: module.settings(str(file),5188,'caddy')
 except ValueError: pass
 else: raise AssertionError('HTTP origin allowed')
`;
 assert.doesNotThrow(()=>execFileSync('python3',['-c',code],{stdio:'pipe'}));
});
