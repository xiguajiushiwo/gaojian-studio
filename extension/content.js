(()=>{
 if(globalThis.__letterPublisherInstalled)return;
 globalThis.__letterPublisherInstalled=true;
 let prepared=null,busy=false;
 const seen=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const normalize=value=>String(value).replace(/\r\n/g,'\n').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();
 const visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const elements=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible);
 const inlineText=node=>node.nodeType===Node.TEXT_NODE?node.textContent:node.nodeName==='BR'?(node.classList.contains('ProseMirror-trailingBreak')?'':'\n'):[...node.childNodes].map(inlineText).join('');
 const inputValue=e=>{
  if(e.matches('input,textarea'))return e.value;
  // ProseMirror renders each logical line as a paragraph; innerText adds a second newline.
  if(e.matches('.tiptap,.ProseMirror')&&e.children.length&&[...e.children].every(n=>n.tagName==='P'))return [...e.children].map(inlineText).join('\n');
  return e.innerText;
 };
 const fail=(message,phase='needs_attention')=>{throw Object.assign(new Error(message),{phase})};
 function guard(){
  if(location.hostname!=='creator.xiaohongshu.com'&&!globalThis.__PUBLISHER_TEST__)fail('当前标签页已离开小红书创作平台。');
  if(location.pathname.includes('/login')||elements('input[placeholder="手机号"]').length)fail('请在这个浏览器完成小红书创作平台登录，然后再自动填写。','login_required');
  const dialogs=elements('[role="dialog"],.captcha-container,.verify-container');
  if(dialogs.some(e=>/安全验证|拖动滑块|完成验证/.test(e.innerText)))fail('小红书要求安全验证，请你手动完成后再试。');
 }
 async function readyPage(){
  const until=Date.now()+20000;
  while(Date.now()<until){
   if(location.pathname.includes('/login')||document.querySelector('input[type="file"],input[placeholder*="标题"],input[placeholder="手机号"]')||(!location.pathname.includes('/publish/publish')&&document.body.innerText.trim().length>50))return;
   await sleep(300);
  }
  fail('创作页面还在加载，请等页面显示完整后再试。');
 }
 function titleField(optional=false){
  const list=elements('input[placeholder*="标题"],textarea[placeholder*="标题"]');
  if(list.length===1)return list[0];if(optional&&!list.length)return null;
  fail('没有识别到唯一的标题输入框。请确认已进入图文编辑页。');
 }
 function bodyField(optional=false){
  const selectors=['[contenteditable="true"][role="textbox"]','.tiptap[contenteditable="true"]','.ql-editor[contenteditable="true"]','textarea[placeholder*="正文"]','[contenteditable="true"]'];
  for(const selector of selectors){const list=elements(selector);if(list.length===1)return list[0]}
  if(optional)return null;fail('没有识别到唯一的正文编辑区。平台页面可能已调整，请在页面中核对。');
 }
 function clickText(text){
  const list=elements('button,[role="tab"],span,div').filter(e=>e.textContent.trim()===text&&!Array.from(e.children).some(c=>visible(c)&&c.textContent.trim()===text));
  if(list.length===1){list[0].click();return true}return false;
 }
 function uploadInput(){
  const inputs=[...document.querySelectorAll('input[type="file"]')].filter(e=>/image|\.png|\.jpg|\.jpeg|\.webp/i.test(e.accept||''));
  const multiple=inputs.filter(e=>e.multiple&&!e.disabled);if(multiple.length===1)return multiple[0];
  if(inputs.length!==1)fail('没有识别到唯一的图片上传入口。请切换到「上传图文」。');return inputs[0];
 }
 function thumbnails(count){
  const selectors=['.img-container .format-img img.preview','.img-preview-area .img-preview','.img-preview-area .img-item','.image-list .image-item','.upload-image-item','.image-item','.img-preview','.thumbnail-item','.image-list [draggable="true"]'];
  for(const selector of selectors){
   const list=elements(selector);if(list.length!==count)continue;
   const sources=list.map(e=>{
    const image=e.matches('img')?e:e.querySelector('img');
    if(image)return image.currentSrc||image.src;
    const bg=getComputedStyle(e).backgroundImage;return bg&&bg!=='none'?bg:'';
   });
   if(sources.every(Boolean))return{selector,sources};
  }
  return null;
 }
 function sameImages(actual,expected){return !!actual&&JSON.stringify(actual.sources)===JSON.stringify(expected.sources)}
 function editorHasContent(){const title=titleField(true),body=bodyField(true);return !!((title&&inputValue(title).trim())||(body&&inputValue(body).trim())||elements('.img-container .format-img img.preview,.img-preview-area .img-preview,.img-preview-area .img-item,.image-list .image-item,.upload-image-item,.image-item,.img-preview,.thumbnail-item').length)}
 function canReuseEditor(payload){return !!(prepared&&prepared.draftId===payload.draftId&&JSON.stringify(prepared.images)===JSON.stringify(payload.images)&&sameImages(thumbnails(payload.images.length),prepared.thumbnails)&&titleField(true)&&bodyField(true)&&normalize(inputValue(titleField()))===normalize(prepared.title)&&normalize(inputValue(bodyField()))===normalize(prepared.body))}
 function setValue(element,value){
  element.focus();
  if(element.matches('input,textarea')){
   const proto=element.matches('textarea')?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);
   element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
  }else{
   const selection=getSelection(),range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);
   if(!document.execCommand('insertText',false,value))fail('正文编辑器不支持自动填入，请在小红书手动粘贴并核对。');
  }
 }
 function verify(payload){
  guard();
  if(!prepared||prepared.proof!==payload.proof)fail('页面已刷新或切换，请先重新自动填写。');
  if(normalize(inputValue(titleField()))!==normalize(payload.title)||normalize(inputValue(bodyField()))!==normalize(payload.body))fail('小红书里的文案发生变化，请重新自动填写后发布。');
  if(!sameImages(thumbnails(payload.images.length),prepared.thumbnails))fail('配图的数量或顺序发生变化，请重新自动填写后发布。');
  const alerts=elements('[role="alert"],.upload-error,.upload-loading');
  if(alerts.some(e=>/上传失败|正在上传|图片处理中/.test(e.innerText)))fail('小红书仍在处理图片，或上传有误，请先检查。');

  return{ok:true};
 }
 async function prepare(payload){
  guard();
  if(!location.pathname.includes('/publish/publish')&&!globalThis.__PUBLISHER_TEST__)fail('请先在小红书打开「发布笔记 → 上传图文」，再点击自动填写。');
  const canReuse=canReuseEditor(payload);
  if(!canReuse&&editorHasContent())fail('这个编辑页已有内容。请先保存原草稿，再打开空白图文发布页，避免混入另一篇笔记。');
  const priorImages=canReuse?prepared.thumbnails:null;prepared=null;
  if(!canReuse){
   clickText('上传图文')||clickText('发布图文');await sleep(500);guard();
   const input=uploadInput(),transfer=new DataTransfer();
   for(const id of payload.images){
    const image=await chrome.runtime.sendMessage({type:'get-image',id});
    if(image.error||!image.base64)fail(image.error||'读取配图失败。');
    const bytes=Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0));
    transfer.items.add(new File([bytes],image.name,{type:image.mime}));
   }
   input.files=transfer.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  let images=priorImages;const until=Date.now()+90000;
  while(Date.now()<until){guard();images=thumbnails(payload.images.length);if(images&&titleField(true)&&bodyField(true))break;await sleep(600)}
  if(!images||!titleField(true)||!bodyField(true))fail('尚未确认全部图片上传成功或未识别到编辑区，请检查小红书页面。');
  setValue(titleField(),payload.title);setValue(bodyField(),payload.body);
  bodyField().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));titleField().focus();
  await sleep(600);
  prepared={proof:payload.proof,draftId:payload.draftId,images:payload.images,thumbnails:images,title:payload.title,body:payload.body};verify(payload);
  return{ok:true,message:'配图、标题和正文已填写并核对。'};
 }
 async function execute(command){
  if(!['inspect','probe','prepare','verify'].includes(command.type))return{ok:false,outcome:'not_submitted',message:'工作台仅支持自动填写，请在小红书手动发布。'};
  if(seen.has(command.id))return seen.get(command.id);
  if(busy)return{ok:false,outcome:'not_submitted',message:'此页已有操作在进行。'};
  busy=true;
  const promise=(async()=>{
   try{
    await readyPage();
    if(command.type==='inspect'){guard();return{ok:true,message:'已连接当前小红书创作页面。填写完成后，请在小红书确认并手动发布。',page:{version:'0.4.0',path:location.pathname,editorReady:!!titleField(true)&&!!bodyField(true)}}}
    if(command.type==='probe'){guard();return{ok:true,hasContent:editorHasContent(),canReuse:canReuseEditor(command.payload)}}
    if(command.type==='prepare')return await prepare(command.payload);
    if(command.type==='verify')return verify(command.payload);

    return{ok:false,message:'未知页面操作。'};
   }catch(error){return{ok:false,outcome:'not_submitted',phase:error.phase||'needs_attention',message:error.message}}
   finally{busy=false}
  })();
  seen.set(command.id,promise);if(seen.size>100)seen.delete(seen.keys().next().value);
  return promise;
 }
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='publisher-command')return;
  execute(message.command).then(respond);return true;
 });
})();
