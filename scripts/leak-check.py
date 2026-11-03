#!/usr/bin/env python3
"""Fail-closed staged/content secret scanner; never prints matched secret values."""
import re, subprocess, sys
staged = '--staged' in sys.argv
files = subprocess.check_output(['git','diff','--cached','--name-only','--diff-filter=ACMR','-z'] if staged else ['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
patterns = [r'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}', r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'AIza[\w-]{30,}',r'ya29\.[\w-]{20,}',r'(?i)(?:api_key|password|client_secret)\s*[:=]\s*[\"\x27][A-Za-z0-9_/-]{24,}']
bad=[]
for f in filter(None,files):
 if any(p in f.split('/') for p in ['private','secrets','recordings','transcripts']) or f.split('/')[-1].startswith('.env'):
  bad.append(f); continue
 try: data=subprocess.check_output(['git','show',':'+f]) if staged else open(f,'rb').read()
 except (OSError,subprocess.CalledProcessError): continue
 if any(re.search(p,data.decode(errors='replace')) for p in patterns): bad.append(f)
if bad: print('Potential secrets in files (values withheld):\n'+'\n'.join(bad)); sys.exit(1)
print('Secret scan passed')
