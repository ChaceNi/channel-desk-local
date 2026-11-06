#!/usr/bin/env python3
"""Deploy a local checkout/prebuilt bundle; no credentials enter Git or image builds."""
import argparse,fcntl,json,os,pathlib,re,stat,subprocess,sys,time,urllib.request,urllib.error,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[2]
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def settings(file,port,proxy):
    file=pathlib.Path(file).absolute()
    if not file.is_file() or file.is_symlink() or ROOT in file.resolve().parents:raise ValueError('Config must be a regular file outside the code directory')
    info=file.stat()
    if info.st_mode&0o077 or info.st_uid==0:raise ValueError('Config must have mode 600 (or 400) and a non-root owner UID for the app container')
    try:config=json.loads(file.read_text())
    except Exception:raise ValueError('Config is not valid JSON') from None
    keys=['CHANNEL_DESK_PUBLIC_ORIGIN','SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET']
    if not isinstance(config,dict) or any(not isinstance(config.get(k),str) or not config[k] or 'REPLACE_' in config[k] for k in keys):raise ValueError('Missing server configuration fields')
    url=urllib.parse.urlsplit(config[keys[0]])
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.path not in ['', '/'] or url.query or url.fragment or url.port not in [None,443]:raise ValueError('Public origin must be an HTTPS hostname on port 443')
    if not re.fullmatch(r'[a-zA-Z0-9.-]+',url.hostname) or not 1024<=port<=65535:raise ValueError('Invalid hostname or local app port')
    return {'root':str(ROOT),'config':str(file),'uid':info.st_uid,'gid':info.st_gid,'origin':'https://'+url.hostname,'domain':url.hostname,'port':port,'proxy':proxy}
def environment(record):
    return {**os.environ,'CHANNEL_DESK_CONFIG_FILE':record['config'],'CHANNEL_DESK_UID':str(record['uid']),'CHANNEL_DESK_GID':str(record['gid']),'CHANNEL_DESK_DOMAIN':record['domain'],'CHANNEL_DESK_HTTP_PORT':str(record['port']),'CHANNEL_DESK_IMAGE':record['image'],'CHANNEL_DESK_BUILD_COMMIT':record.get('commit') or '','CHANNEL_DESK_BUILD_DIRTY':str(record.get('dirty',True)).lower()}
def compose(record,*args,capture=False):
    command=['docker','compose','--project-name','channel-desk','--file',str(pathlib.Path(record['root'])/'compose.yaml')]
    if record['proxy']=='caddy':command+=['--profile','https']
    return run(command+list(args),env=environment(record),stdout=subprocess.PIPE if capture else None,text=True)
def request(url,**kwargs):
    with urllib.request.urlopen(urllib.request.Request(url,**kwargs),timeout=15) as response:return json.load(response)
def verify(record):
    for attempt in range(30):
        try:
            health=request('http://127.0.0.1:'+str(record['port'])+'/api/health')
            version=health.get('release',{})
            if version.get('version')==record['version'] and (not record.get('commit') or version.get('commit')==record['commit']):break
        except Exception:pass
        if attempt==29:raise ValueError('App health/revision check failed; run rollback if a previous release exists')
        time.sleep(2)
    headers={'Host':record['domain'],'X-Forwarded-Proto':'https'}
    session=request('http://127.0.0.1:'+str(record['port'])+'/api/auth/session',headers=headers)
    if session.get('authMode')!='shopify' or session.get('authenticated') is not False:raise ValueError('App authentication gate failed')
    for attempt in range(18):
        try:
            public=request(record['origin']+'/api/health')
            if public.get('release',{}).get('version')==record['version'] and (not record.get('commit') or public.get('release',{}).get('commit')==record['commit']):break
        except Exception:pass
        if attempt==17:raise ValueError('Public HTTPS/revision check failed; check DNS, certificate and reverse proxy')
        time.sleep(3)
    public_session=request(record['origin']+'/api/auth/session')
    if public_session.get('authMode')!='shopify' or public_session.get('authenticated') is not False:raise ValueError('Public Shopify login mode check failed')
    try:
        request(record['origin']+'/api/dashboard',data=b'{}',headers={'Origin':record['origin'],'Content-Type':'application/json'},method='POST')
        raise ValueError('Unauthenticated report API was not denied')
    except urllib.error.HTTPError as error:
        if error.code!=401:raise ValueError('Unexpected report gate status') from None
def write_state(file,value):
    temporary=file.with_suffix('.tmp');temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(file)
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['deploy','rollback','status'])
    parser.add_argument('--config',default=os.environ.get('CHANNEL_DESK_CONFIG_FILE',str(pathlib.Path.home()/'.config/channel-desk/runtime.config.json')))
    parser.add_argument('--proxy',choices=['caddy','external'],default='caddy')
    parser.add_argument('--port',type=int,default=5188)
    args=parser.parse_args()
    state_dir=pathlib.Path(os.environ.get('CHANNEL_DESK_STATE_DIR',str(pathlib.Path.home()/'.local/state/channel-desk')))
    state_dir.mkdir(parents=True,exist_ok=True,mode=0o700);state_dir.chmod(0o700)
    state_file=state_dir/'deployment.json'
    with (state_dir/'deployment.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        state=json.loads(state_file.read_text()) if state_file.exists() else {}
        if args.action=='status':
            if not state.get('active'):print('No deployment record');return
            compose(state['active'],'ps');print(json.dumps({k:state['active'].get(k) for k in ['version','commit','healthy','origin','proxy']},indent=2));return
        if args.action=='rollback':
            previous=state.get('previous')
            if not previous or not previous.get('healthy'):raise ValueError('No previous healthy deployed image is recorded')
            current=state.get('active',previous)
            infrastructure=settings(current['config'],current['port'],current['proxy'])
            target={**current,**infrastructure,**{k:previous[k] for k in ['root','image','version','commit','dirty']}}
            compose(target,'up','-d','--no-build','--remove-orphans');verify(target)
            write_state(state_file,{'active':{**target,'healthy':True},'previous':state.get('active')})
            print('Rollback healthy: '+target['version']);return
        record=settings(args.config,args.port,args.proxy)
        package=json.loads((ROOT/'package.json').read_text());metadata={}
        if (ROOT/'release-info.json').exists():metadata=json.loads((ROOT/'release-info.json').read_text())
        try:
            git_root=subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=ROOT,stderr=subprocess.DEVNULL,text=True).strip()
            if pathlib.Path(git_root).resolve()!=ROOT:raise ValueError('Ignore unrelated parent Git repository')
            commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,stderr=subprocess.DEVNULL,text=True).strip()
            dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
            metadata={**metadata,'commit':commit,'dirty':dirty}
        except Exception:pass
        commit=metadata.get('commit')
        if commit and not re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})',commit):raise ValueError('Invalid build commit')
        image='channel-desk:release-'+str(time.time_ns())
        record.update(image=image,version=package['version'],commit=commit,dirty=metadata.get('dirty',True),healthy=False)
        if not state.get('active'):
            existing=run(['docker','ps','-aq','--filter','label=com.docker.compose.project=channel-desk'],stdout=subprocess.PIPE,text=True).stdout.strip()
            if existing:raise ValueError('Unmanaged channel-desk containers already exist; inspect them before adopting this manager')
        compose(record,'build','app')
        previous=state.get('active') if state.get('active',{}).get('healthy') else state.get('previous')
        write_state(state_file,{'active':record,'previous':previous})
        compose(record,'up','-d','--no-build','--remove-orphans');verify(record)
        record['healthy']=True;write_state(state_file,{'active':record,'previous':previous})
        print('Deployment healthy: '+record['version']+' '+(commit or '(unversioned source)'))
if __name__=='__main__':
    try:main()
    except (ValueError,OSError,subprocess.CalledProcessError) as error:
        print('Deployment failed: '+str(error),file=sys.stderr);sys.exit(1)
