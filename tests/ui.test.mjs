import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {getPlaywright,edgePath} from '../lib/runtime.mjs';

test('本地页面重启后保留修改并恢复凭证；断线禁用发布，恢复不自动重发',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-ui-'));
 let submissions=0,app,browser;
 const start=async port=>{
  app=createApp({dataDir,importExample:false,publisherFactory:store=>({busy:false,state:()=>({phase:'connected',message:'模拟扩展连接',browserOpen:true,connectionLabel:'已连接当前浏览器',logs:[]}),prepare:async id=>{assert.equal(store.get(id).title,'重启后保留的修改');submissions++}})});
  app.server.listen(port,'127.0.0.1');await once(app.server,'listening');return app.server.address().port;
 };
 const stop=async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r))};
 try{
  const port=await start(0),image=app.store.addImage(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'));
  app.store.put({title:'原始标题',body:'本地模拟测试，不访问小红书',tags:[],images:[image.id]});
  const {chromium}=await getPlaywright();browser=await chromium.launch({headless:true,executablePath:edgePath()});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+port);
  await page.locator('#title').fill('重启后保留的修改');
  await stop();await start(port);
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='已保存');
  assert.equal(submissions,1);assert.equal(await page.locator('#title').inputValue(),'重启后保留的修改');assert.equal(await page.locator('#publish').count(),0);assert.equal(await page.locator('#publish-top').count(),0);assert.equal(app.store.attempts().length,0);
  await stop();await page.waitForFunction(()=>document.querySelector('#phase-label').textContent==='服务已关闭');
  assert.equal(await page.locator('#prepare').isDisabled(),true);
  await start(port);await page.waitForFunction(()=>document.querySelector('#connection-label').textContent==='已连接当前浏览器');
  assert.equal(await page.locator('#prepare').isEnabled(),true);assert.equal(submissions,1);
 }finally{if(browser)await browser.close();if(app?.server.listening)await stop();fs.rmSync(dataDir,{recursive:true,force:true})}
});

test('对话交付自动展示全文和每张配图；手动编辑遇到新稿不会丢失',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-sync-'));
 const app=createApp({dataDir,importExample:false});let browser;
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 try{
  const image=app.store.addImage(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'));
  const image2=app.store.addImage(Buffer.concat([fs.readFileSync(app.store.imagePath(image.id)),Buffer.from('second')]));
  app.store.put({title:'原有内容',body:'旧稿',tags:[],images:[image.id]});
  const {chromium}=await getPlaywright();browser=await chromium.launch({headless:true,executablePath:edgePath()});const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+app.server.address().port);await page.locator('#title').waitFor();
  const delivery=app.store.deliver({title:'周末的城市散步',body:'第一段\n\n完整正文的最后一句',tags:['城市生活'],images:[image.id,image2.id],category:'旅行',brief:'轻松自然'});
  await page.waitForFunction(()=>document.querySelector('#title').value==='周末的城市散步');
  assert.match(await page.locator('#preview-body').innerText(),/最后一句/);
  await page.locator('#preview-next').click();assert.equal(await page.locator('#preview-page-label').innerText(),'2 / 2');
  await page.locator('#expand-preview').click();assert.equal(await page.locator('#expanded-image').getAttribute('src'),'/api/images/'+image2.id);await page.locator('#close-preview').click();
  // Keep a visible manual edit pending while another writer delivers a revision.
  await page.route('**/api/drafts/'+delivery.id,route=>route.request().method()==='PUT'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'DRAFT_CONFLICT',error:'有新版本'})}):route.continue());
  await page.locator('#body').fill('我正在手动调整的内容');
  app.store.deliver({...delivery,draftId:delivery.id,expectedVersion:1,body:'对话交付的第二版'});
  await page.locator('#sync-banner').waitFor({state:'visible'});assert.equal(await page.locator('#body').inputValue(),'我正在手动调整的内容');
  await page.locator('#sync-open').click();await page.waitForFunction(()=>document.querySelector('#body').value==='对话交付的第二版');
  assert.ok(app.store.drafts().some(d=>d.body==='我正在手动调整的内容'&&d.id!==delivery.id));
  assert.equal(app.store.attempts().length,0);
  await page.locator('#search').fill('城市');assert.equal(await page.locator('.draft-item').count(),2);
 }finally{if(browser)await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(dataDir,{recursive:true,force:true})}
});
