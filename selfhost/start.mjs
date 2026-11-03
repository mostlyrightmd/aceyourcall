import { webhookRelay } from './webhook-relay.mjs';
import {spawn} from 'node:child_process';
import {readFileSync, mkdirSync} from 'node:fs';
const config=JSON.parse(readFileSync('/config/app.json','utf8'));
Object.assign(process.env,config);
if(process.env.MP_PAID_ENABLED==='1' && !process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_FILE)throw Error('Configure a server-side OpenAI key before enabling paid calls');
mkdirSync('private',{recursive:true,mode:0o700});
const children=['src/server.js','src/call-server.js'].map(file=>spawn(process.execPath,[file],{stdio:'inherit',env:process.env}));
const relay=webhookRelay(config);
relay.listen(Number(config.CALL_PORT), '172.29.92.1');
relay.on('error',()=>stop(1));
let stopping=false;
function stop(code){if(stopping)return;stopping=true;relay.close();for(const c of children)c.kill('SIGTERM');setTimeout(()=>{for(const c of children)c.kill('SIGKILL');process.exit(code);},10000).unref();Promise.all(children.map(c=>c.exitCode!==null?Promise.resolve():new Promise(r=>c.once('exit',r)))).then(()=>process.exit(code));}
for(const c of children)c.once('exit',code=>{if(!stopping)stop(code||1);});
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));
