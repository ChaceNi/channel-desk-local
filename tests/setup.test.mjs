import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('setup saves private credentials outside source, refuses overwrites and validates public origins',()=>{
 const code=String.raw`
import importlib.util,tempfile,pathlib,json,os,stat
spec=importlib.util.spec_from_file_location('setup','deploy/server/setup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
assert module.public_origin('sales.example.com')=='https://sales.example.com'
for value in ['http://sales.example.com','https://name:password@sales.example.com','https://sales.example.com/path']:
 try:module.public_origin(value)
 except ValueError:continue
 raise AssertionError('unsafe origin accepted')
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);root.chmod(0o700);file=root/'runtime.config.json'
 data={'CHANNEL_DESK_PUBLIC_ORIGIN':'https://sales.example.com','SHOPIFY_CLIENT_ID':'id','SHOPIFY_CLIENT_SECRET':'test-secret-only'}
 module.save_config(file,data)
 assert stat.S_IMODE(file.stat().st_mode)==0o600
 assert json.loads(file.read_text())==data
 try:module.save_config(file,{'replacement':'bad'})
 except FileExistsError:pass
 else:raise AssertionError('existing secret overwritten')
 link=root/'linked.json';link.symlink_to(file)
 try:module.save_config(link,data)
 except ValueError:pass
 else:raise AssertionError('symlink accepted')
`;
 assert.doesNotThrow(()=>execFileSync('python3',['-c',code],{stdio:'pipe'}));
});
