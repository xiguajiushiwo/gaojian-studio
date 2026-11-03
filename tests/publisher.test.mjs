import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {Store,validateDraft,composedBody} from '../lib/store.mjs';
import {ExtensionPublisher} from '../lib/bridge.mjs';
import {createApp} from '../server.mjs';
const dirs=[],png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
const temp=()=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-test-'));dirs.push(p);return p};
const example=store=>{const image=store.addImage(png);return store.put({title:'一封测试来信',body:'测试正文',tags:['动漫'],images:[image.id]})};
const tick=()=>new Promise(r=>setImmediate(r));
test.after(()=>{for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true})});
test('正文与话题一起检查长度，图片拒绝 HTML 和越界路径',()=>{
 const store=new Store(temp());assert.throws(()=>store.addImage(Buffer.from('<html>not an image</html>')),/仅支持/);assert.throws(()=>store.imagePath('../library.json'),/无效/);
 assert.throws(()=>validateDraft({title:'测试',body:'字'.repeat(999),tags:['动漫'],images:[]}),/1000/);
 assert.throws(()=>validateDraft({title:'字'.repeat(21),body:'文',tags:[],images:[]}),/20/);
 assert.equal(composedBody({body:' 正文 ',tags:['动漫']}),'正文\n\n#动漫');
});
test('提交前持久保存记录，重启后标记未知，跨草稿阻止同内容重复发送',()=>{
 const root=temp(),store=new Store(root),draft=example(store),snapshot=store.snapshot(draft.id);
 store.beginAttempt(snapshot);
 const next=new Store(root);assert.equal(next.attempts()[0].status,'uncertain');
 const clone=next.put(draft);assert.equal(next.snapshot(clone.id).fingerprint,snapshot.fingerprint);
 assert.throws(()=>next.checkDuplicate(snapshot.fingerprint),/尚未确认/);
 next.resolveAttempt(next.attempts()[0].id,'not_published');assert.doesNotThrow(()=>next.checkDuplicate(snapshot.fingerprint));
});
test('配对码单次使用、限制错误尝试，连接令牌不对外显示',()=>{
 const p=new ExtensionPublisher(new Store(temp())),id='a'.repeat(32),code=p.pairingInfo().code;
 const pair=p.pair(code,id,10);assert.equal(p.authenticate(pair.token,id).tabId,10);assert.throws(()=>p.authenticate('invalid',id),/失效/);
 assert.throws(()=>p.pair(code,id,11),/过期/);assert.ok(!JSON.stringify(p.state()).includes(pair.token));
 for(let i=0;i<5;i++)assert.throws(()=>p.pair('wrong',id,10));assert.throws(()=>p.pair(p.pairingInfo().code,id,10),/次数/);
});
test('命令取出后不重复派发，即使结果应答丢失',async()=>{
 const p=new ExtensionPublisher(new Store(temp()));p.pair(p.pairingInfo().code,'a'.repeat(32),10);
 const pending=p.request('inspect',{},2000),command=await p.poll();assert.equal(command.type,'inspect');
 assert.equal(p.command.delivered,true);assert.equal(p.receive(command.id,{ok:true}),true);assert.equal(p.receive(command.id,{ok:true}),false);assert.deepEqual(await pending,{ok:true});
});
test('填写成功后停在编辑页，不创建发布记录，不派发提交命令',async()=>{
 const store=new Store(temp()),draft=example(store),p=new ExtensionPublisher(store);p.pair(p.pairingInfo().code,'a'.repeat(32),10);
 const task=p.prepare(draft.id);assert.equal(p.busy,true);await assert.rejects(p.prepare(draft.id),/已有操作/);
 const command=await p.poll();assert.equal(command.type,'prepare');assert.equal(command.payload.title,draft.title);p.receive(command.id,{ok:true});await task;
 assert.equal(p.state().phase,'prepared');assert.equal(p.state().mode,'fill-only');assert.equal(p.state().canPublish,false);
 assert.match(p.state().message,/手动点击发布/);assert.equal(p.command,null);assert.equal(p.busy,false);assert.equal(store.attempts().length,0);
 assert.equal(typeof p.publishNow,'undefined');assert.equal(typeof p.publish,'undefined');
 for(const type of ['publish','publish-now'])assert.throws(()=>p.request(type,{}),/仅支持自动填写/);
 assert.equal(p.command,null);
});
test('填写失败或连接检查不会继续提交，旧扩展提示转换为手动发布流程',async()=>{
 const store=new Store(temp()),draft=example(store),p=new ExtensionPublisher(store);p.pair(p.pairingInfo().code,'a'.repeat(32),10);
 let task=p.prepare(draft.id),command=await p.poll();p.receive(command.id,{ok:false,message:'图片未上传完成'});await task;
 assert.equal(p.command,null);assert.equal(p.state().canPublish,false);assert.equal(store.attempts().length,0);
 task=p.inspect();command=await p.poll();p.receive(command.id,{ok:true,message:'点击一键发布即可提交'});await task;
 assert.match(p.state().message,/填写到小红书/);assert.ok(!p.state().message.includes('一键发布'));
});

test('HTTP 拒绝跨站写入、伪造 Host 和未配对扩展，正常草稿可保存',async()=>{
 const {server,publisher,store}=createApp({dataDir:temp(),importExample:false});server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  const forged=await new Promise((resolve,reject)=>{const req=http.get(origin+'/api/state',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)});
  assert.equal(forged,403);
  const page=await(await fetch(origin)).text(),token=page.match(/publisher-token" content="([^"]+)"/)[1];
  assert.equal((await fetch(origin+'/api/drafts',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'})).status,403);
  const response=await fetch(origin+'/api/drafts',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Publisher-Token':token},body:JSON.stringify({title:'保存草稿',body:'正文',tags:[],images:[]})});
  assert.equal(response.status,201);
  for(const action of ['publish','publish-now']){
   const blocked=await fetch(origin+'/api/automation/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Publisher-Token':token},body:'{}'});
   assert.equal(blocked.status,410);assert.equal((await blocked.json()).code,'MANUAL_PUBLISH_REQUIRED');
  }
  assert.equal(publisher.command,null);assert.equal(store.attempts().length,0);
  assert.equal((await fetch(origin+'/bridge/poll',{method:'POST',headers:{'X-Publisher-Extension':'a'.repeat(32),'Content-Type':'application/json'},body:'{}'})).status,400);
  assert.equal((await fetch(origin+'/data/library.json')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});

test('通用成稿保留创作要求和版本，冲突不会覆盖手动编辑，恢复不删除历史',()=>{
 const store=new Store(temp()),draft=example(store);
 const delivered=store.deliver({...draft,draftId:draft.id,expectedVersion:1,title:'城市散步的三个小习惯',category:'城市生活',brief:'给周末散步的人，语气轻松',deliveryNote:'补充了三个实用建议'});
 assert.equal(delivered.version,2);assert.equal(delivered.updatedBy,'assistant');assert.equal(store.data.latestDelivery.draftId,draft.id);
 const edited=store.put({...delivered,body:'用户自己补充的内容',expectedVersion:2},draft.id);
 assert.equal(edited.version,3);assert.throws(()=>store.deliver({...delivered,draftId:draft.id,expectedVersion:2,body:'过时修改稿'}),e=>e.code==='DRAFT_CONFLICT');
 assert.equal(store.get(draft.id).body,edited.body);assert.equal(store.history(draft.id).length,3);
 const restored=store.restore(draft.id,2,3);assert.equal(restored.version,4);assert.equal(restored.body,delivered.body);assert.equal(restored.brief,delivered.brief);
 assert.equal(new Store(store.root).history(draft.id).length,4);
});

test('只允许已派发的填写任务切换编辑页，检查任务不能改变目标',async()=>{
 const p=new ExtensionPublisher(new Store(temp()));p.pair(p.pairingInfo().code,'a'.repeat(32),10);
 assert.throws(()=>p.retarget('wrong',20),/没有/);
 let task=p.request('prepare',{},2000),cmd=await p.poll();assert.throws(()=>p.retarget('wrong',20),/没有/);
 p.retarget(cmd.id,20);assert.equal(p.connection.tabId,20);assert.equal(p.store.data.extensionConnection.tabId,20);
 assert.throws(()=>p.retarget(cmd.id,30),/切换过/);p.receive(cmd.id,{ok:true});await task;
 task=p.request('inspect',{},2000);cmd=await p.poll();assert.equal(cmd.tabId,20);assert.throws(()=>p.retarget(cmd.id,30),/没有/);p.receive(cmd.id,{ok:true});await task;
});
