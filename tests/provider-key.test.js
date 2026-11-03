import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('provider uses environment or file keys without gcloud and fails closed on an invalid file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ace-key-'));const file=join(dir,'key');writeFileSync(file,'file-test-value\n');
 const run=extra=>spawnSync(process.execPath,['--input-type=module','-e','import {key} from "./src/provider.js";process.stdout.write(key());'],{encoding:'utf8',env:{...process.env,OPENAI_API_KEY:'env-test-value',OPENAI_API_KEY_FILE:'',...extra}});
 try{assert.equal(run({}).stdout,'env-test-value');assert.equal(run({OPENAI_API_KEY_FILE:file}).stdout,'file-test-value');const failed=run({OPENAI_API_KEY_FILE:join(dir,'missing')});assert.notEqual(failed.status,0);assert.doesNotMatch(failed.stderr,/env-test-value/);}finally{rmSync(dir,{recursive:true,force:true});}
});
