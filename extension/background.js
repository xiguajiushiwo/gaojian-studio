const BASE='http://127.0.0.1:4188';
let running=false,connection=null;
async function api(route,data={},token=connection?.token){
 const response=await fetch(BASE+'/bridge/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Publisher-Extension':chrome.runtime.id,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'发布台连接失败');return result;
}
async function loaded(tab){
 if(tab.status==='loading'){
  await new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener)};
   const listener=(id,info)=>{if(id===tab.id&&info.status==='complete'){cleanup();resolve()}};
   // Third-party resources may keep the tab loading after the editor is ready.
   // Continue to the content script's DOM readiness check instead of failing here.
   const timer=setTimeout(()=>{cleanup();resolve()},25000);
   chrome.tabs.onUpdated.addListener(listener);
   chrome.tabs.get(tab.id).then(t=>{if(t.status==='complete'){cleanup();resolve()}}).catch(e=>{cleanup();reject(e)});
  });
  tab=await chrome.tabs.get(tab.id);
 }
 return tab;
}
async function execute(command){
 if(!['inspect','probe','prepare','verify'].includes(command.type))return{ok:false,outcome:'not_submitted',message:'工作台仅支持自动填写，请在小红书手动发布。'};
 let tab;try{tab=await chrome.tabs.get(command.tabId)}catch{return{ok:false,outcome:'not_submitted',message:'连接的小红书标签页已关闭，请打开创作平台并重新连接。'}}
 if(command.type==='prepare'&&tab.url?.startsWith('https://creator.xiaohongshu.com/')&&new URL(tab.url).pathname!=='/publish/publish'&&!new URL(tab.url).pathname.includes('/login')){
  await chrome.tabs.update(tab.id,{url:'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image'});tab={...tab,status:'loading'};
 }
 tab=await loaded(tab);
 if(!tab.url?.startsWith('https://creator.xiaohongshu.com/'))return{ok:false,outcome:'not_submitted',message:'连接的标签页不在小红书创作平台，请重新连接创作页面。'};
 if(command.type==='prepare'){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true})}
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
 if(command.type==='prepare'){
  const probe=await chrome.tabs.sendMessage(tab.id,{type:'publisher-command',command:{...command,id:command.id+'-probe',type:'probe'}});
  if(!probe.ok)return probe;
  if(probe.hasContent&&!probe.canReuse){
   // Preserve the existing editor; each unrelated draft gets a fresh tab.
   tab=await chrome.tabs.create({windowId:tab.windowId,url:'about:blank',active:true});
   await api('target',{commandId:command.id,tabId:tab.id});
   connection={...connection,tabId:tab.id};await chrome.storage.local.set({connection});command={...command,tabId:tab.id};
   await chrome.tabs.update(tab.id,{url:'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image'});
   tab=await loaded({...tab,status:'loading'});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
  }
 }
 return await chrome.tabs.sendMessage(tab.id,{type:'publisher-command',command});
}
async function report(commandId,result){
 // Repeating a result acknowledgement is safe; never repeat the page action.
 for(let i=0;i<3;i++){try{return await api('result',{commandId,result})}catch{await new Promise(r=>setTimeout(r,1500))}}
}
async function loop(){
 if(running)return;running=true;
 try{
  connection=(await chrome.storage.local.get('connection')).connection;
  while(connection){
   try{
    const {command}=await api('poll');
    await chrome.storage.local.set({lastError:''});
    if(command)execute(command).then(result=>report(command.id,result)).catch(error=>report(command.id,{ok:false,outcome:'not_submitted',message:error.message}));
   }catch(error){
    await chrome.storage.local.set({lastError:error.message});
    if(/连接已失效/.test(error.message)){connection=null;await chrome.storage.local.remove('connection');break}
    await new Promise(r=>setTimeout(r,4000));
   }
   connection=(await chrome.storage.local.get('connection')).connection;
  }
 }finally{running=false}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 (async()=>{
  if(message.type==='connect'){
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('请从扩展面板连接。');
   const [active]=await chrome.tabs.query({active:true,currentWindow:true});
   let tab=active;
   if(!tab?.url?.startsWith('https://creator.xiaohongshu.com/'))tab=await chrome.tabs.create({url:'https://creator.xiaohongshu.com/publish/publish?source=official'});
   const paired=await api('pair',{code:message.code,tabId:tab.id},null);
   connection={token:paired.token,tabId:tab.id};await chrome.storage.local.set({connection,lastError:''});loop();
   return{ok:true,message:'已连接。回到发布台点击「检查连接」，确认登录后即可自动填写。'};
  }
  if(message.type==='get-image'){
   const saved=(await chrome.storage.local.get('connection')).connection;
   if(sender.tab?.id!==saved?.tabId||!sender.url?.startsWith('https://creator.xiaohongshu.com/'))throw new Error('图片请求来自未连接页面。');
   return await api('image',{id:message.id},saved.token);
  }
  if(message.type==='status'){loop();const saved=await chrome.storage.local.get(['connection','lastError']);return{ok:true,connected:!!saved.connection,error:saved.lastError||''}}
  throw new Error('未知操作。');
 })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
});
chrome.runtime.onStartup.addListener(()=>loop());chrome.runtime.onInstalled.addListener(()=>loop());
loop();
