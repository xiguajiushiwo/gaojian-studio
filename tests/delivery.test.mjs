import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';

test('对话交付命令导入本地配图、更新同一篇并拒绝过时版本，全程不触发发布',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-delivery-')),app=createApp({dataDir:path.join(root,'data')});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const origin='http://127.0.0.1:'+app.server.address().port,script=fileURLToPath(new URL('../tools/deliver-note.mjs',import.meta.url)),noteFile=path.join(root,'note.json');
 const run=()=>promisify(execFile)(process.execPath,[script,noteFile],{env:{...process.env,PUBLISHER_URL:origin}});
 try{
  fs.writeFileSync(path.join(root,'cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'));
  const note={title:'今天分享一个小习惯',body:'不同主题也能交付到工作台。',tags:['日常'],imagePaths:['cover.png'],brief:'轻松自然',category:'生活'};
  fs.writeFileSync(noteFile,JSON.stringify(note));let result=JSON.parse((await run()).stdout);assert.equal(result.version,1);assert.equal(result.images,1);
  fs.writeFileSync(noteFile,JSON.stringify({...note,draftId:result.id,expectedVersion:1,body:'调整后的正文'}));result=JSON.parse((await run()).stdout);assert.equal(result.version,2);
  await assert.rejects(run(),/新版本/);assert.equal(app.store.get(result.id).body,'调整后的正文');assert.equal(app.store.history(result.id).length,2);assert.equal(app.store.attempts().length,0);assert.equal(app.publisher.command,null);
 }finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(root,{recursive:true,force:true})}
});
