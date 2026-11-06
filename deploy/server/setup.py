#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Interactive server setup. Never accepts secrets in arguments or downloads scripts."""
import argparse,getpass,json,os,pathlib,re,shutil,subprocess,sys,urllib.parse,warnings

ROOT=pathlib.Path(__file__).resolve().parents[2]

class SetupError(ValueError):pass

def public_origin(value):
    value=value.strip()
    if '://' not in value:value='https://'+value
    url=urllib.parse.urlsplit(value)
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.port not in [None,443] or url.path not in ['', '/'] or url.query or url.fragment:
        raise SetupError('请填写正式 HTTPS 根域名，不包含路径、账号或自定义端口。')
    if not re.fullmatch(r'[A-Za-z0-9.-]+',url.hostname):raise SetupError('域名格式无效。')
    return 'https://'+url.hostname

def save_config(file,config):
    file=pathlib.Path(file).absolute()
    if ROOT in file.resolve().parents:raise SetupError('密钥配置必须位于代码目录外。')
    if file.parent.is_symlink() or file.is_symlink():raise SetupError('配置路径不能使用符号链接。')
    file.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
    info=file.parent.stat()
    if info.st_mode&0o077 or info.st_uid!=os.getuid():raise SetupError('请使用由当前账号持有、权限 700 的专用配置目录。')
    # O_EXCL prevents replacing an existing secret or following a raced symlink.
    descriptor=os.open(str(file),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'w') as stream:
        stream.write(json.dumps(config,indent=2)+'\n')
    if os.getuid()==0:os.chown(file,1000,1000)

def prerequisites():
    if not sys.platform.startswith('linux'):raise SetupError('此向导用于普通 Linux 服务器；不会在本机测试电脑启动服务。')
    if not sys.stdin.isatty() or not sys.stderr.isatty():raise SetupError('请在交互式服务器终端运行，以便隐藏输入 Secret。')
    if not shutil.which('docker'):raise SetupError('请先安装 Docker Engine 和 Compose 插件：https://docs.docker.com/engine/install/')
    for args in [['docker','compose','version'],['docker','info']]:
        result=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if result.returncode:raise SetupError('Docker/Compose 不可用，或当前账号没有 Docker 操作权限。')

def confirmed(prompt):return input(prompt+' [y/N] ').strip().lower() in ['y','yes']

def main():
    parser=argparse.ArgumentParser(description='Channel Desk 一条命令引导部署（Linux + Docker）')
    parser.add_argument('--config',default=str(pathlib.Path.home()/'.config/channel-desk/runtime.config.json'))
    args=parser.parse_args()
    prerequisites()
    from manage import settings
    file=pathlib.Path(args.config).absolute()
    print('Channel Desk 部署向导：密钥只保存在本服务器，不写入仓库或镜像。')
    print('任一家指定店铺的报表员工登录后，都可以查看和导出两店数据。')
    choice=input('HTTPS 入口：1 新站点/Caddy自动证书；2 已有Nginx/HTTPS [1] ').strip() or '1'
    if choice not in ['1','2']:raise SetupError('请选择 1 或 2。')
    proxy='caddy' if choice=='1' else 'external'
    port_text=input('应用本机端口 [5188] ').strip() or '5188'
    if not port_text.isdigit() or not 1024<=int(port_text)<=65535:raise SetupError('端口必须在 1024–65535 之间。')
    port=int(port_text)
    if file.exists() or file.is_symlink():
        try:record=settings(str(file),port,proxy)
        except ValueError:raise SetupError('已有配置未通过检查：请确认文件权限、持有者和 HTTPS 地址。') from None
        origin=record['origin']
        print('发现已有私有配置，将原样复用，不显示或覆盖 Secret。')
        config=None
    else:
        origin=public_origin(input('正式域名（如 sales.example.com）：'))
        config={'CHANNEL_DESK_PUBLIC_ORIGIN':origin}
    print('请在 Shopify 应用中新增允许回调：'+origin+'/auth/shopify/callback')
    print('应用首页可设为：'+origin+'/')
    if not confirmed('是否已登记上述 Shopify 回调？'):print('已停止；请完成回调登记后重新运行。');return
    requirement='域名已解析到本服务器，80/443 已开放且没有其他服务占用' if proxy=='caddy' else '已有 HTTPS 代理已配置到本机端口 '+str(port)
    if not confirmed('请确认：'+requirement):print('已停止；请完成域名/HTTPS 准备后重新运行。');return
    if config is not None:
        client_id=input('Shopify Client ID：').strip()
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            try:secret=getpass.getpass('Shopify Client Secret（隐藏输入）：').strip()
            except getpass.GetPassWarning:raise SetupError('终端无法安全隐藏输入，请使用交互式 SSH 终端重试。') from None
        if not client_id or not secret or any('REPLACE_' in v for v in [client_id,secret]):raise SetupError('必须填写真实的应用凭据。')
        config.update(SHOPIFY_CLIENT_ID=client_id,SHOPIFY_CLIENT_SECRET=secret)
    if not confirmed('现在构建并启动此站点？这会使用网站端口并使已有登录会话失效。'):
        print('已取消，没有写入新的密钥配置或启动服务。');return
    if config is not None:
        save_config(file,config)
        del config,secret
    command=[sys.executable,str(ROOT/'deploy/server/manage.py'),'deploy','--config',str(file),'--proxy',proxy,'--port',str(port)]
    subprocess.run(command,check=True)
    print('部署完成：'+origin)

if __name__=='__main__':
    try:main()
    except SetupError as error:
        print(str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,OSError,subprocess.CalledProcessError,EOFError,KeyboardInterrupt):
        # Do not include input values, parser documents or subprocess environments.
        print('部署向导未完成。请检查上方准备步骤、Docker 权限、配置文件权限和域名；不会打印密钥。',file=sys.stderr)
        sys.exit(1)
