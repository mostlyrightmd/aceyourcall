#!/usr/bin/env python3
"""Prepare reviewable files only. Does not deploy or enable public access.
Input JSON: {dailyUsd, accounts:[{id,secret,availableUsd,expiresAt,concurrency}],
             legacySpentUsd}. Budgets are partitions, not a rotating shared limit.
"""
import json, sys, re, os
from pathlib import Path
from datetime import datetime, timezone
if len(sys.argv) != 3: sys.exit('Usage: prepare-community-pool.py funding.json output-directory')
os.umask(0o077)
c=json.loads(Path(sys.argv[1]).read_text()); accounts=c['accounts']; total=sum(a['concurrency'] for a in accounts)
assert 1 <= total <= 20 and len({a['id'] for a in accounts}) == len(accounts)
assert 0 < c['dailyUsd'] <= sum(a['availableUsd'] for a in accounts)
assert c.get('legacySpentUsd',0) >= 0
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=False,mode=0o700)
workers=[]; units=[]; index=0
layout=["#!/bin/sh", "set -eu", "# Run on the VM only after reviewing and approving the deployment."]
for a in accounts:
    assert re.fullmatch(r'[a-z0-9-]{1,50}',a['id'])
    assert re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',a['secret'])
    assert isinstance(a['concurrency'],int) and a['concurrency'] >= 1
    assert a['availableUsd'] > 0
    expiry=datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'))
    assert expiry.tzinfo and expiry > datetime.now(timezone.utc)
    # Floor partitions to cents; never allocate more than declared credits.
    per=int(a['availableUsd']*100/a['concurrency'])/100
    daily=int(c['dailyUsd']*100/total)/100
    assert per >= 1.7 and daily >= 1.7, 'Each slot needs $1.70 conservative headroom'
    for _ in range(a['concurrency']):
        wid='default' if index==0 else f'worker-{index:02d}'
        port=4317 if index==0 else 4400+index
        baseline=c.get('legacySpentUsd',0) if index==0 else 0
        workdir='/opt/mock-partner' if index==0 else f'/var/lib/mock-partner/{wid}'
        unit='mp-app' if index==0 else 'mp-'+wid
        workers.append({'id':wid,'origin':f'http://localhost:{port}'})
        env=f'PORT={port}\nMP_PAID_ENABLED=1\nMP_APPROVED_USD={per+baseline:.8f}\nMP_DAILY_CAP_USD={daily:.2f}\nMP_CYCLE_CAP_USD={per+baseline:.8f}\nMP_OPENAI_SECRET={a["secret"]}\nMP_CREDIT_EXPIRES_AT={a["expiresAt"]}\n'
        (out/(wid+'.env')).write_text(env)
        (out/(unit+'.service')).write_text(f'''[Unit]
Description=Mock Partner isolated interview worker {wid}
After=network-online.target
[Service]
User=mp
WorkingDirectory={workdir}
EnvironmentFile=/etc/mock-partner-pool/{wid}.env
ExecStart=/usr/bin/node /opt/mock-partner/src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
''')
        if index:
            layout += [f'install -d -o mp -g mp -m 700 {workdir}',f'install -d -o mp -g mp -m 700 {workdir}/private']
            for asset in ['public','profiles','grounding']:
                layout += [f'test ! -e {workdir}/{asset} || test -L {workdir}/{asset}',f'ln -sfn /opt/mock-partner/{asset} {workdir}/{asset}']
        units.append({'unit':unit,'workingDirectory':workdir,'creditAccount':a['id'],'allowanceUsd':per,'dailyUsd':daily,'expiry':a['expiresAt']});index+=1
(out/'prepare-layout.sh').write_text('\n'.join(layout)+'\n')
(out/'operators.json').write_text(json.dumps(workers,indent=2)+'\n')
(out/'review.json').write_text(json.dumps({'capacity':total,'allocatedUsd':sum(u['allowanceUsd'] for u in units),'dailyUsd':sum(u['dailyUsd'] for u in units),'workers':units,'publicLaunchEnabled':False},indent=2)+'\n')
print(f'Prepared {total} workers in {out}. No deployment or public access enabled. Review allocations and provider concurrency limits before applying.')
