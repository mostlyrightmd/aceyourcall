#!/usr/bin/env python3
"""Generate local secrets/configuration. Never prints API keys or creator capabilities."""
import argparse, getpass, ipaddress, json, os, pathlib, re, secrets
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--domain', help='Apex app hostname; also create rtc. and turn. DNS records')
p.add_argument('--ip', help='Public IPv4 for remote media')
p.add_argument('--port',type=int,default=4320)
p.add_argument('--operator-port',type=int,default=4317)
p.add_argument('--rtc-port',type=int,default=7880)
p.add_argument('--rtc-tcp',type=int,default=7881)
p.add_argument('--udp-start',type=int,default=50000)
p.add_argument('--no-key',action='store_true',help='Offline installation check; AI stays disabled')
p.add_argument('--anonymous',action='store_true',help='Public anonymous creation: requires Turnstile credentials')
a=p.parse_args()
if a.domain and (not re.fullmatch(r'[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?',a.domain) or '.' not in a.domain):p.error('Use a hostname, without scheme or path')
if a.domain and not a.ip:p.error('--domain requires --ip for media')
if a.ip:ipaddress.IPv4Address(a.ip)
if a.anonymous and not a.domain:p.error('--anonymous requires HTTPS domain')
ports=[a.port,a.operator_port,a.rtc_port,a.rtc_tcp]
if len(set(ports))!=4 or any(n<1024 or n>65535 for n in ports) or not 1024<=a.udp_start<=65335:p.error('Use distinct unprivileged ports and a valid UDP range')
root=pathlib.Path(__file__).resolve().parent/'generated'
if root.exists():p.error('generated/ already exists; preserve it for upgrades. Move it aside only to intentionally create new credentials.')
api='' if a.no_key else os.environ.get('OPENAI_API_KEY','') or getpass.getpass('OpenAI project API key (hidden): ').strip()
if not a.no_key and not api:p.error('Key required; use --no-key for offline setup')
site=os.environ.get('MP_TURNSTILE_SITEKEY','');turnstile=os.environ.get('MP_TURNSTILE_SECRET','')
if a.anonymous and (not site or not turnstile):p.error('Set MP_TURNSTILE_SITEKEY and MP_TURNSTILE_SECRET before anonymous setup')
os.umask(0o077);root.mkdir(mode=0o700)
key=secrets.token_hex(12);secret=secrets.token_hex(32);access=secrets.token_urlsafe(32)
origin='https://'+a.domain if a.domain else f'http://localhost:{a.port}'
config={'PORT':str(a.operator_port),'CALL_PORT':str(a.port),'MP_CALL_ORIGIN':origin,'MP_CALL_BIND':'127.0.0.1','MP_CALL_ACCESS':access,'LIVEKIT_API_KEY':key,'LIVEKIT_API_SECRET':secret,'LIVEKIT_URL':f'wss://rtc.{a.domain}' if a.domain else f'ws://localhost:{a.rtc_port}','LIVEKIT_INTERNAL_URL':f'http://127.0.0.1:{a.rtc_port}','MP_COMMUNITY_PREVIEW':'0' if a.domain else '1','MP_PAID_ENABLED':'1' if api else '0','MP_APPROVED_USD':'10','MP_DAILY_CAP_USD':'5','MP_CYCLE_CAP_USD':'10','MP_OPERATOR_ORIGIN':f'http://localhost:{a.operator_port}','MP_OPERATOR_POOL_PATH':'/config/operators.json','MP_POSTHOG_TOKEN':'','MP_MEDIA_WEBHOOK_READY':'1'}
if api:config['OPENAI_API_KEY_FILE']='/config/openai-key'
if a.anonymous:config.update(MP_PUBLIC_LAUNCH='1',MP_TURNSTILE_SITEKEY=site,MP_TURNSTILE_SECRET=turnstile)
rtc={'tcp_port':a.rtc_tcp,'port_range_start':a.udp_start,'port_range_end':a.udp_start+100,'use_external_ip':False}
rtc['node_ip']=a.ip or '127.0.0.1'
livekit={'port':a.rtc_port,'rtc':rtc,'keys':{key:secret},'room':{'max_participants':4,'empty_timeout':300,'departure_timeout':20},'webhook':{'api_key':key,'urls':[f'http://172.29.92.1:{a.port}/rtc-events']},'logging':{'level':'warn'}}
if a.domain:
 livekit['turn']={'enabled':True,'domain':'turn.'+a.domain,'tls_port':443,'udp_port':3478,'external_tls':True,'proxy_protocol':True,'proxy_protocol_trusted_cidrs':['172.29.92.1/32'],'relay_range_start':a.udp_start+101,'relay_range_end':a.udp_start+200}
 routes=[]
 for hostname,port in [(a.domain,a.port),('rtc.'+a.domain,a.rtc_port),('turn.'+a.domain,15349)]:
  tls={'handler':'tls'}
  if port!=15349:tls['connection_policies']=[{'alpn':['http/1.1']}]
  proxy={'handler':'proxy','upstreams':[{'dial':[f'127.0.0.1:{port}']}]}
  if port==15349:proxy['proxy_protocol']='v2'
  routes.append({'match':[{'tls':{'sni':[hostname]}}],'handle':[tls,proxy]})
 caddy={'admin':{'disabled':True},'storage':{'module':'file_system','root':'/data'},'apps':{'tls':{'certificates':{'automate':[a.domain,'rtc.'+a.domain,'turn.'+a.domain]}},'layer4':{'servers':{'main':{'listen':[':443'],'routes':routes}}}}}
 (root/'caddy.json').write_text(json.dumps(caddy,indent=2))
# LiveKit has its own network namespace: it can listen on/advertise TLS 443
# while Caddy owns host 443. Only the TLS proxy backend is mapped to loopback.
media_bind='' if a.domain else '127.0.0.1:'
media={'services':{'livekit':{'image':'livekit/livekit-server:v1.13.11','command':'--config /config/livekit.yaml','restart':'unless-stopped','volumes':['./:/config:ro'],'ports':[f'127.0.0.1:{a.rtc_port}:{a.rtc_port}',f'{media_bind}{a.rtc_tcp}:{a.rtc_tcp}',f'{media_bind}{a.udp_start}-{a.udp_start+100}:{a.udp_start}-{a.udp_start+100}/udp'],'networks':['media'],'logging':{'options':{'max-size':'10m','max-file':'3'}}}},'networks':{'media':{'ipam':{'config':[{'subnet':'172.29.92.0/24','gateway':'172.29.92.1'}]}}}}
if a.domain:media['services']['livekit']['ports'] += ['127.0.0.1:15349:443','3478:3478/udp',f'{a.udp_start+101}-{a.udp_start+200}:{a.udp_start+101}-{a.udp_start+200}/udp']
(root/'media-compose.yaml').write_text(json.dumps(media,indent=2)+'\n')
for name,data in [('app.json',config),('livekit.yaml',livekit),('operators.json',[{'id':'default','origin':f'http://localhost:{a.operator_port}'}])]:
 (root/name).write_text(json.dumps(data,indent=2)+'\n')
(root/'openai-key').write_text(api)
(root/'creator-url.txt').write_text(origin+'/#create='+access+'\n')
# Containers run as UID 1000. A root-run Linux setup assigns only this private directory.
if os.geteuid()==0:
 for f in [root,*root.iterdir()]:os.chown(f,1000,1000)
print('Configuration created in selfhost/generated/. Keep this directory private and backed up.')
print('Start: docker compose -f selfhost/compose.yaml '+('--profile https ' if a.domain else '')+'up --build -d')
print('Open '+origin+('/new' if not a.domain else '/'))
if a.domain and not a.anonymous:print('Private creation: open the URL from selfhost/generated/creator-url.txt once on your browser. Do not share this host capability.')
