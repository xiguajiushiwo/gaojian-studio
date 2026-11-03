import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getPlaywright,edgePath} from '../lib/runtime.mjs';
const script=fs.readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=';
let browser;
test.before(async()=>{const {chromium}=await getPlaywright();browser=await chromium.launch({headless:true,executablePath:edgePath()})});
test.after(async()=>browser?.close());
async function fixture(){
 const page=await browser.newPage();
 await page.setContent('<button id="tab">上传图文</button><input type="file" accept="image/png" multiple><div id="images"></div><input placeholder="填写标题"><div contenteditable="true" role="textbox"></div><button id="publish">发布</button><div id="result"></div>');
 await page.evaluate(image=>{
  globalThis.__PUBLISHER_TEST__=true;
  globalThis.chrome={runtime:{onMessage:{addListener:handler=>globalThis.dispatch=handler},sendMessage:async()=>({base64:image,mime:'image/png',name:'test.png'})}};
  document.querySelector('input[type=file]').addEventListener('change',event=>{document.querySelector('#images').innerHTML=Array.from(event.target.files).map((f,i)=>'<div class="image-item"><img width="90" height="90" src="data:image/png;base64,'+image+'#'+i+'"></div>').join('')});
  globalThis.clicks=0;document.querySelector('#publish').onclick=()=>{globalThis.clicks++;document.querySelector('#result').textContent='发布成功'};
 },image);
 await page.addScriptTag({content:script});return page;
}
const command=(page,type,payload,id=crypto.randomUUID())=>page.evaluate(({type,payload,id})=>new Promise(resolve=>globalThis.dispatch({type:'publisher-command',command:{id,type,payload}},{},resolve)),{type,payload,id});
test('真实 DOM 操作：上传与填写后停止，旧发布命令也不能触发提交',async()=>{
 const page=await fixture(),payload={proof:'proof-1',title:'一封来信',body:'第一段\n\n第二段\n#动漫',images:['a.png','b.png']};
 try{
  assert.equal((await command(page,'prepare',payload)).ok,true);
  assert.equal(await page.locator('.image-item').count(),2);assert.equal(await page.locator('input[placeholder]').inputValue(),payload.title);
  assert.equal((await command(page,'verify',payload)).ok,true);
  const id=crypto.randomUUID();assert.equal((await command(page,'publish',payload,id)).outcome,'not_submitted');assert.equal((await command(page,'publish',payload,id)).outcome,'not_submitted');
  assert.equal(await page.evaluate(()=>globalThis.clicks),0);
 }finally{await page.close()}
});
test('页面被改动、配图被调序或登录失效时，不会点击发布',async()=>{
 const page=await fixture(),payload={proof:'proof-2',title:'检查页面',body:'示例正文',images:['a.png','b.png']};
 try{
  assert.equal((await command(page,'prepare',payload)).ok,true);
  await page.locator('input[placeholder]').fill('外部修改');
  assert.equal((await command(page,'verify',payload)).ok,false);
  await page.locator('input[placeholder]').fill(payload.title);
  await page.evaluate(()=>{const images=document.querySelector('#images');images.prepend(images.lastElementChild)});
  assert.equal((await command(page,'verify',payload)).ok,false);
  await page.evaluate(()=>{const input=document.createElement('input');input.placeholder='手机号';document.body.append(input)});
  assert.equal((await command(page,'inspect',{})).phase,'login_required');assert.equal(await page.evaluate(()=>globalThis.clicks),0);
 }finally{await page.close()}
});
test('已有其他草稿时保留内容，不把新图片混入原稿',async()=>{
 const page=await fixture();try{await page.locator('input[placeholder]').fill('原来的草稿');const result=await command(page,'prepare',{proof:'test',title:'新稿',body:'正文',images:['a.png']});assert.equal(result.ok,false);assert.match(result.message,/已有内容/);assert.equal(await page.locator('input[placeholder]').inputValue(),'原来的草稿');assert.equal(await page.locator('.image-item').count(),0)}finally{await page.close()}
});

test('新版编辑页：选择批量上传入口并识别六张缩略图，不把手机预览算入配图',async()=>{
 const page=await fixture(),payload={proof:'modern',title:'新版图文',body:'新版正文\n\n#动漫',images:['1.png','2.png','3.png','4.png','5.png','6.png']};
 try{
  await page.evaluate(image=>{
   const replacement=document.createElement('input');replacement.type='file';replacement.accept='.jpg,.jpeg,.png,.webp';document.body.append(replacement);
   const multiple=document.querySelector('input[multiple]');multiple.accept='.jpg,.jpeg,.png,.webp';
   multiple.addEventListener('change',event=>{
    document.querySelector('#images').innerHTML=Array.from(event.target.files).map((f,i)=>'<div class="img-container"><div class="format-img"><img class="img preview" width="80" height="80" src="data:image/png;base64,'+image+'#'+i+'"></div></div>').join('')+'<div class="phone-preview"><img width="80" height="80" src="data:image/png;base64,'+image+'"></div>';
   });
  },image);
  assert.equal((await command(page,'prepare',payload)).ok,true);
  assert.equal(await page.locator('.img-container').count(),6);
  assert.equal((await command(page,'verify',payload)).ok,true);
  await page.evaluate(()=>{const images=document.querySelector('#images');images.prepend(images.querySelectorAll('.img-container')[5])});
  assert.equal((await command(page,'verify',payload)).ok,false);
  assert.equal(await page.evaluate(()=>globalThis.clicks),0);
 }finally{await page.close()}
});

test('ProseMirror 的段落换行按原文校验，仍拒绝文字和真实换行被修改',async()=>{
 const page=await fixture(),payload={proof:'paragraphs',title:'段落测试',body:'第一行\n第二行\n\n新的段落💌\n#动漫',images:['a.png']};
 try{
  await page.evaluate(()=>{
   const editor=document.querySelector('[contenteditable]');editor.className='tiptap ProseMirror';
   let timer;editor.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{
    const lines=editor.innerText.split('\n');editor.replaceChildren(...lines.map(text=>{const p=document.createElement('p');if(text)p.textContent=text;else{const br=document.createElement('br');br.className='ProseMirror-trailingBreak';p.append(br)}return p}));
   },0)});
  });
  assert.equal((await command(page,'prepare',payload)).ok,true);
  assert.equal((await command(page,'verify',payload)).ok,true);
  await page.evaluate(()=>document.querySelector('.tiptap p').append('修改'));
  assert.equal((await command(page,'verify',payload)).ok,false);
  await page.evaluate(()=>{const lines=document.querySelectorAll('.tiptap p');lines[0].textContent='第一行'+lines[1].textContent;lines[1].remove()});
  assert.equal((await command(page,'verify',payload)).ok,false);assert.equal(await page.evaluate(()=>globalThis.clicks),0);
 }finally{await page.close()}
});

test('发布按钮不可用也能填写；保留用户的声明设置并拒绝自动提交',async()=>{
 const page=await fixture(),payload={proof:'manual',title:'人工确认',body:'请用户确认后发布',images:['a.png']};
 try{
  await page.evaluate(()=>{
   document.querySelector('#publish').disabled=true;
   const declaration=document.createElement('input');declaration.type='checkbox';declaration.id='ai-declaration';declaration.checked=true;document.body.append(declaration);
  });
  assert.equal((await command(page,'prepare',payload)).ok,true);
  assert.equal(await page.locator('#ai-declaration').isChecked(),true);
  assert.equal((await command(page,'publish',payload)).outcome,'not_submitted');
  assert.equal(await page.evaluate(()=>globalThis.clicks),0);
  await page.locator('#publish').evaluate(e=>e.disabled=false);
  assert.equal((await command(page,'publish',payload)).outcome,'not_submitted');
  assert.equal(await page.evaluate(()=>globalThis.clicks),0);
 }finally{await page.close()}
});
