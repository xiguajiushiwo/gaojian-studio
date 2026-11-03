const $=s=>document.querySelector(s);
let token=$('meta[name="publisher-token"]').content,serviceOnline=true;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=s=>[...s].length;
let current=null,drafts=[],automation={},attempts=[],dirty=false,revision=0,saveTimer,saveChain=Promise.resolve(),uploading=false,acting=false;
let previewIndex=0,filter='all',pendingSync=null,lastDeliveryKey=null,saving=0,refreshing=false;
const localVersions=new Map();
function setSidebarCollapsed(collapsed,{persist=true,moveFocus=true}={}){
 const sidebar=$('#studio-sidebar'),open=$('#sidebar-open'),close=$('#sidebar-close');
 const transferFocus=moveFocus&&(collapsed?sidebar.contains(document.activeElement):document.activeElement===open);
 document.querySelector('.app-shell').classList.toggle('sidebar-collapsed',collapsed);
 sidebar.hidden=collapsed;open.hidden=!collapsed;
 for(const button of [open,close])button.setAttribute('aria-expanded',String(!collapsed));
 if(persist)try{localStorage.setItem('studio-sidebar-collapsed',String(collapsed))}catch{}
 if(transferFocus)(collapsed?open:close).focus({preventScroll:true});
}
let sidebarCollapsed=false;
try{sidebarCollapsed=localStorage.getItem('studio-sidebar-collapsed')==='true'}catch{}
setSidebarCollapsed(sidebarCollapsed,{persist:false,moveFocus:false});
$('#sidebar-close').onclick=()=>setSidebarCollapsed(true);
$('#sidebar-open').onclick=()=>setSidebarCollapsed(false);
async function api(route,data,method='POST',retrySession=true){
 const response=await fetch('/api'+route,data===undefined?{}:{method,headers:{'Content-Type':'application/json','X-Publisher-Token':token},body:JSON.stringify(data)});
 const value=await response.json();
 if(response.status===403&&retrySession&&data!==undefined&&value.error?.startsWith('页面已失效')){
  const page=await(await fetch('/')).text(),fresh=new DOMParser().parseFromString(page,'text/html').querySelector('meta[name="publisher-token"]')?.content;
  if(fresh){token=fresh;return api(route,data,method,false)}
 }
 if(!response.ok)throw Object.assign(new Error(value.error||'操作失败'),{code:value.code});return value;
}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4500)}
function bodyText(d=current){return d.body.trim()+(d.tags.length?'\n\n'+d.tags.map(t=>'#'+t).join(' '):'')}
function readFields(){if(!current)return;current.title=$('#title').value;current.body=$('#body').value;current.tags=$('#tags').value.trim().split(/[\s,，]+/).map(t=>t.replace(/^#+/,'')).filter(Boolean);current.category=$('#category').value;current.brief=$('#brief').value}
function touch(){readFields();dirty=true;revision++;$('#save-status').textContent='有修改';preview();buttons();clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(!automation.busy&&!uploading&&!acting)save().catch(e=>{$('#save-status').textContent='未保存';toast(e.message)})},900)}
function renderList(){
 const query=$('#search').value.trim().toLowerCase(),published=d=>attempts.some(a=>a.draftId===d.id&&a.status==='published');
 const list=drafts.filter(d=>(!query||(d.title+' '+(d.category||'')).toLowerCase().includes(query))&&(filter==='all'||filter==='published'&&published(d)||filter==='review'&&d.updatedBy==='assistant'&&!published(d)));
 $('#library-count').textContent=drafts.length;
 $('#draft-list').innerHTML=list.map(d=>'<button class="draft-item '+(d.id===current?.id?'active':'')+'" data-draft="'+d.id+'">'+(d.images[0]?'<img class="draft-thumb" src="/api/images/'+d.images[0]+'" alt="">':'<span class="draft-thumb">▤</span>')+'<span><strong>'+esc(d.title||'新的内容')+'</strong><small>'+(published(d)?'已发布':d.updatedBy==='assistant'?'成稿待预览':'编辑中')+' · '+d.images.length+' 张 · V'+(d.version||1)+'</small></span></button>').join('')||'<p class="draft-empty">'+(query?'没有找到相关内容。':'这里还没有内容。<br>从一个新想法开始吧。')+'</p>';
}
function loadDraft(d){
 current=structuredClone(d);dirty=false;revision++;previewIndex=0;localVersions.set(d.id,d.version||1);$('#title').value=d.title;$('#body').value=d.body;$('#tags').value=d.tags.map(t=>'#'+t).join(' ');$('#brief').value=d.brief||'';$('#category').value=d.category||'';
 $('#versions').textContent='V'+(d.version||1)+' · 版本记录';$('#delivery-note').hidden=d.updatedBy!=='assistant';$('#delivery-note').textContent=d.deliveryNote||'成稿已送达。看看文案与配图，有想调整的地方，继续在对话里告诉我。';
 const url=new URL(location.href);url.searchParams.set('draft',d.id);history.replaceState(null,'',url);localStorage.setItem('studio-selected-draft',d.id);
 $('#save-status').textContent='已保存';$('#draft-label').textContent=d.title||'未命名笔记';renderList();renderImages();preview();buttons();
 renderAutomation();
}
function renderImages(){
 $('#image-count').textContent=current.images.length+' / 18';$('#image-tab-count').textContent=current.images.length;
 $('#image-grid').innerHTML=current.images.map((id,i)=>'<div class="image-tile"><button class="image-open" data-preview="'+i+'" aria-label="预览第 '+(i+1)+' 张配图"><img src="/api/images/'+id+'" alt="第 '+(i+1)+' 张配图"></button><span class="image-badge">'+(i===0?'封面':String(i+1).padStart(2,'0'))+'</span><div class="image-actions"><button data-image-action="left" data-index="'+i+'" aria-label="将第 '+(i+1)+' 张图片前移" '+(i===0?'disabled':'')+'>←</button><button data-image-action="right" data-index="'+i+'" aria-label="将第 '+(i+1)+' 张图片后移" '+(i===current.images.length-1?'disabled':'')+'>→</button><button data-image-action="remove" data-index="'+i+'" aria-label="移除第 '+(i+1)+' 张配图">×</button></div></div>').join('');
}
function preview(){
 if(!current)return;
 $('#title-count').textContent=count(current.title.trim())+' / 20';$('#title-count').classList.toggle('over-limit',count(current.title.trim())>20);
 $('#body-count').textContent=count(bodyText())+' / 1000（含话题）';$('#body-count').classList.toggle('over-limit',count(bodyText())>1000);
 previewIndex=Math.max(0,Math.min(previewIndex,current.images.length-1));const image=current.images[previewIndex];
 $('#preview-picture').innerHTML=image?'<img src="/api/images/'+image+'" alt="第 '+(previewIndex+1)+' 张配图"><span class="preview-pages">'+(previewIndex+1)+' / '+current.images.length+'</span>':'<span class="empty-cover"><small>YOUR NEXT STORY</small><strong>下一篇内容，<br>从一句话开始。</strong><i>做好配图后，来这里看效果。</i></span>';
 $('#preview-page-label').textContent=image?(previewIndex+1)+' / '+current.images.length:'暂无配图';$('#preview-dots').innerHTML=current.images.map((id,i)=>'<button data-preview="'+i+'" class="'+(i===previewIndex?'active':'')+'" aria-label="预览第 '+(i+1)+' 张配图"></button>').join('');
 for(const id of ['#preview-prev','#expanded-prev'])$(id).disabled=previewIndex===0;for(const id of ['#preview-next','#expanded-next'])$(id).disabled=!image||previewIndex===current.images.length-1;
 $('#preview-title').textContent=current.title||'给你的笔记起个名字';$('#preview-body').textContent=current.body||'正文预览会显示在这里。';$('#preview-tags').textContent=current.tags.map(t=>'#'+t).join(' ');
 $('#expanded-image').hidden=!image;if(image)$('#expanded-image').src='/api/images/'+image;$('#expanded-title').textContent=current.title||'新的内容';$('#expanded-body').textContent=current.body;$('#expanded-tags').textContent=current.tags.map(t=>'#'+t).join(' ');$('#expanded-page').textContent=image?(previewIndex+1)+' / '+current.images.length:'暂无配图';
 const missing=[];if(!current.title.trim())missing.push('标题');if(!current.body.trim())missing.push('正文');if(!current.images.length)missing.push('配图');$('#publish-summary').textContent=missing.length?'还差 '+missing.join('、')+'，即可自动填写。':current.images.length+' 张配图 · 文案 '+count(bodyText())+' 字 · 填好后去小红书确认';
}
async function save(){
 if(!current||!dirty)return current;
 readFields();const snapshot=structuredClone(current),atRevision=revision;$('#save-status').textContent='保存中…';saving++;
 const run=async()=>{
  const {draft}=await api('/drafts/'+snapshot.id,{...snapshot,expectedVersion:localVersions.get(snapshot.id)||snapshot.version||1},'PUT');localVersions.set(draft.id,draft.version);
  drafts=drafts.map(d=>d.id===draft.id?draft:d);
  if(current?.id===draft.id){current.version=draft.version;$('#versions').textContent='V'+draft.version+' · 版本记录';if(revision===atRevision){current=draft;dirty=false;$('#save-status').textContent='已保存';$('#draft-label').textContent=draft.title||'未命名笔记';$('#delivery-note').hidden=true}}
  renderList();buttons();return draft;
 };
 saveChain=saveChain.catch(()=>{}).then(run).catch(async error=>{if(error.code==='DRAFT_CONFLICT'){await refresh();$('#save-status').textContent='有新版本，编辑已保留'}throw error}).finally(()=>{saving--;buttons()});return saveChain;
}
function buttons(){
 const busy=!!automation.busy||acting||uploading||!serviceOnline,canPrepare=current&&current.title.trim()&&current.body.trim()&&current.images.length;
 for(const selector of ['#open-browser','#inspect','#new-draft','#save','#images','#versions'])$(selector).disabled=busy;
 $('#prepare').disabled=busy||!canPrepare||!automation.browserOpen;

 $('#prepare-top').disabled=$('#prepare').disabled;
 $('#prepare').textContent=automation.busy?'正在处理，请稍候…':'填写到小红书';
 for(const el of document.querySelectorAll('.image-actions button,.draft-item'))el.disabled=busy||el.dataset.imageAction==='left'&&Number(el.dataset.index)===0||el.dataset.imageAction==='right'&&Number(el.dataset.index)===current.images.length-1;
 for(const selector of ['#title','#body','#tags','#brief','#category'])$(selector).readOnly=busy;
}
const phases={offline:'服务已关闭',idle:'等待开始',opening:'正在连接',connected:'已连接',login_required:'等待登录',preparing:'准备中',uploading:'上传图片',filling:'填写文案',prepared:'已填写，待你确认',publishing:'提交中',published:'已提交成功',uncertain:'需要核对',error:'操作未完成',needs_attention:'需要处理'};
function renderAutomation(){
 const same=!automation.draftId||automation.draftId===current?.id;
 const message=automation.phase==='connected'?'已连接小红书创作页面。填写完成后，请在小红书确认设置并手动发布。':automation.phase==='prepared'?'配图和文案已填写，尚未发布。请在小红书检查内容、完成设置后手动发布。':automation.message;
 $('#phase-label').textContent=same||automation.busy?phases[automation.phase]||'等待开始':'待预览';$('#automation-status').textContent=same||automation.busy||!serviceOnline?message||'连接浏览器，即可自动填写。':automation.browserOpen?'浏览器已连接。填写后请在小红书确认设置并手动发布。':'请先连接已登录的小红书创作平台。';
 $('#automation-status').classList.toggle('attention',['offline','error','needs_attention','uncertain','login_required'].includes(automation.phase));
 $('#connection-label').textContent=automation.connectionLabel||'扩展未连接';
 $('#connection-dot').classList.toggle('connected',!!automation.browserOpen&&serviceOnline);
 $('#show-screenshot').hidden=!automation.screenshot;
 $('#logs').innerHTML=(automation.logs||[]).map(l=>'<li><time>'+new Date(l.time).toLocaleTimeString('zh-CN')+'</time><span>'+esc(l.message)+'</span></li>').join('');
 buttons();
}
function renderHistory(){
 $('#legacy-history').hidden=!attempts.length;
 $('#history-count').textContent=attempts.length+' 条记录';
 $('#history-list').innerHTML=attempts.length?attempts.map(a=>'<article class="history-item"><div><strong>'+esc(a.title)+'</strong><p>'+new Date(a.createdAt).toLocaleString('zh-CN')+'</p></div><span class="attempt-status '+a.status+'">'+({published:'已提交成功',submitting:'提交中',uncertain:'结果待核对',not_published:'已确认未发布'}[a.status]||a.status)+'</span>'+(a.status==='uncertain'?'<div class="resolve-buttons"><span>在小红书核对后：</span><button data-resolve="published" data-attempt="'+a.id+'">已经发布</button><button data-resolve="not_published" data-attempt="'+a.id+'">确认未发布</button></div>':'')+'</article>').join(''):'<div class="history-empty"><span>✧</span><p>第一篇分享，还在准备中。<small>手动发布的结果请在小红书笔记管理查看。</small></p></div>';
}
async function refresh(initial=false){
 let data;try{data=await api('/state')}catch(error){serviceOnline=false;automation={...automation,busy:false,browserOpen:false,canPublish:false,phase:'offline',connectionLabel:'本地服务未启动',message:'本地发布助手服务已关闭。重新启动服务后，此页会自动恢复连接。'};renderAutomation();throw error}
 serviceOnline=true;drafts=data.drafts;automation=data.automation;attempts=data.attempts;
 const deliveryKey=data.latestDelivery?data.latestDelivery.draftId+':'+data.latestDelivery.version:null;
 const canSync=!dirty&&!saving&&!uploading&&!acting&&!automation.busy;
 if(initial||!current){if(!drafts.length){const made=await api('/drafts',{title:'',body:'',tags:[],images:[]});drafts=[made.draft]}const selected=new URL(location.href).searchParams.get('draft')||localStorage.getItem('studio-selected-draft');loadDraft(drafts.find(d=>d.id===selected)||drafts[0]);lastDeliveryKey=deliveryKey}
 else{
  const remote=drafts.find(d=>d.id===current.id),delivered=deliveryKey&&deliveryKey!==lastDeliveryKey?drafts.find(d=>d.id===data.latestDelivery.draftId):null;
  const changed=delivered||(remote&&(remote.version||1)>(current.version||1)?remote:null);
  if(changed){if(canSync){loadDraft(changed);pendingSync=null;toast(changed.updatedBy==='assistant'?'成稿已送达，来看看这一版。':'内容已同步。')}else pendingSync=changed}
  if(deliveryKey)lastDeliveryKey=deliveryKey;
 }
 showSyncBanner();
 renderList();renderAutomation();renderHistory();
}
function showSyncBanner(){if(pendingSync?.id===current?.id&&(pendingSync.version||1)<=(current.version||1))pendingSync=null;$('#sync-banner').hidden=!pendingSync;if(!pendingSync)return;$('#sync-title').textContent='《'+(pendingSync.title||'新的内容')+'》的新版本已送达';$('#sync-description').textContent=dirty?'你的编辑已保留。可以先将它另存为一篇，再查看新版本。':'这一版已经准备好，随时可以查看。';$('#sync-open').textContent=dirty?'保留编辑并查看':'查看新版本'}
function setPanel(panel){for(const tab of document.querySelectorAll('[data-panel]'))tab.setAttribute('aria-selected',String(tab.dataset.panel===panel));for(const name of ['copy','images','brief'])$('#panel-'+name).hidden=name!==panel}
async function action(name){
 if(acting||automation.busy||uploading)return;
 acting=true;buttons();
 try{
  clearTimeout(saveTimer);if(name==='prepare')await save();
  await api('/automation/'+name,{draftId:current?.id});
  await refresh();
 }catch(error){toast(error.message)}finally{acting=false;buttons()}
}
async function addImages(files){
 if(uploading||automation.busy)return;const list=[...files];if(current.images.length+list.length>18){toast('每篇最多 18 张配图。');return}
 uploading=true;buttons();
 try{
  for(const file of list){
   if(file.size>20*1024*1024)throw new Error('单张图片不能超过 20 MB。');
   const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
   const {image}=await api('/images',{base64:dataUrl.split(',')[1]});
   if(!current.images.includes(image.id))current.images.push(image.id);
   dirty=true;revision++;renderImages();preview();
  }
  await save();toast('配图已添加。');
 }catch(error){toast(error.message)}finally{uploading=false;$('#images').value='';buttons()}
}
$('#open-browser').onclick=async()=>{try{const info=await api('/connection');$('#pairing-code').textContent=info.code;$('#extension-path').value=decodeURIComponent(info.extensionPath);$('#connection-dialog').showModal()}catch(e){toast(e.message)}};
$('#close-connection').onclick=()=>$('#connection-dialog').close();
$('#connection-check').onclick=()=>{$('#connection-dialog').close();action('inspect')};
$('#copy-extension-path').onclick=()=>navigator.clipboard.writeText($('#extension-path').value).then(()=>toast('扩展文件夹路径已复制。')).catch(()=>toast('请手动复制路径。'));
$('#inspect').onclick=()=>action('inspect');$('#prepare').onclick=()=>action('prepare');
$('#prepare-top').onclick=()=>action('prepare');
$('#save').onclick=()=>save().then(()=>toast('草稿已保存在这台电脑。')).catch(e=>toast(e.message));
for(const id of ['#title','#body','#tags','#brief','#category'])$(id).addEventListener('input',touch);
$('#images').onchange=event=>addImages(event.target.files);
$('#upload-area').ondragover=event=>{event.preventDefault();$('#upload-area').classList.add('dragover')};
$('#upload-area').ondragleave=()=>$('#upload-area').classList.remove('dragover');
$('#upload-area').ondrop=event=>{event.preventDefault();$('#upload-area').classList.remove('dragover');addImages(event.dataTransfer.files)};
$('#image-grid').onclick=event=>{const button=event.target.closest('[data-image-action]');if(!button||button.disabled)return;const i=Number(button.dataset.index),action=button.dataset.imageAction;if(action==='remove')current.images.splice(i,1);else{const j=i+(action==='left'?-1:1);[current.images[i],current.images[j]]=[current.images[j],current.images[i]]}renderImages();touch()};
for(const container of ['#image-grid','#preview-dots'])$(container).addEventListener('click',event=>{const button=event.target.closest('[data-preview]');if(button){previewIndex=Number(button.dataset.preview);preview()}});
for(const button of ['#preview-prev','#expanded-prev'])$(button).onclick=()=>{previewIndex--;preview()};
for(const button of ['#preview-next','#expanded-next'])$(button).onclick=()=>{previewIndex++;preview()};
for(const button of ['#expand-preview','#preview-picture'])$(button).onclick=()=>{preview();$('#preview-dialog').showModal()};
$('#close-preview').onclick=()=>$('#preview-dialog').close();
for(const tab of document.querySelectorAll('[data-panel]'))tab.onclick=()=>setPanel(tab.dataset.panel);
$('#search').oninput=renderList;
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;for(const b of document.querySelectorAll('[data-filter]'))b.classList.toggle('active',b===button);renderList()};
$('#draft-list').onclick=async event=>{const item=event.target.closest('[data-draft]');if(!item||item.disabled)return;try{await save();loadDraft(drafts.find(d=>d.id===item.dataset.draft))}catch(error){toast(error.message)}};
$('#new-draft').onclick=async()=>{try{await save();const {draft}=await api('/drafts',{title:'',body:'',tags:[],images:[],brief:'',category:''});drafts.unshift(draft);loadDraft(draft);setPanel('brief');$('#brief').focus()}catch(error){toast(error.message)}};
$('#sync-open').onclick=async()=>{if(!pendingSync)return;const target=pendingSync;try{if(dirty){readFields();const {draft}=await api('/drafts',{...current,deliveryNote:'保留的手动编辑'});drafts.unshift(draft);toast('你的编辑已另存为一篇。')}pendingSync=null;loadDraft(drafts.find(d=>d.id===target.id)||target);showSyncBanner()}catch(e){toast(e.message)}};
$('#workflow-help').onclick=()=>$('#workflow-dialog').showModal();$('#close-workflow').onclick=()=>$('#workflow-dialog').close();$('#start-brief').onclick=()=>{$('#workflow-dialog').close();setPanel('brief');$('#brief').focus()};
$('#copy-brief').onclick=async()=>{try{readFields();await save();await navigator.clipboard.writeText('请'+(current.title?'调整工作台中的《'+current.title+'》':'帮我制作一篇小红书图文')+'。\n'+(current.category?'主题：'+current.category+'\n':'')+(current.brief||'请按我的要求准备标题、正文、话题与配图。')+'\n做好后请同步到工作台供我预览。');toast('已复制，粘贴到当前对话即可。')}catch(e){toast(e.message)}};
$('#versions').onclick=async()=>{try{const {versions}=await api('/drafts/'+current.id+'/history');$('#versions-list').innerHTML=versions.map((v,i)=>'<article class="version-row"><div><strong>V'+v.version+' · '+(v.updatedBy==='assistant'?'对话交付':'手动编辑')+(i===0?' · 当前版本':'')+'</strong>'+(i?'<button data-restore="'+v.version+'">恢复这一版</button>':'')+'</div><small>'+new Date(v.updatedAt).toLocaleString('zh-CN')+' · '+v.images.length+' 张配图</small><p class="version-title">'+esc(v.title||'新的内容')+'</p><p>'+esc(v.body)+'</p></article>').join('');$('#versions-dialog').showModal()}catch(e){toast(e.message)}};
$('#close-versions').onclick=()=>$('#versions-dialog').close();$('#versions-list').onclick=async event=>{const button=event.target.closest('[data-restore]');if(!button)return;try{await save();const {draft}=await api('/drafts/'+current.id+'/restore',{version:Number(button.dataset.restore),expectedVersion:current.version});drafts=drafts.map(d=>d.id===draft.id?draft:d);loadDraft(draft);$('#versions-dialog').close();toast('已恢复为新版本，旧内容仍可回看。')}catch(e){toast(e.message)}};
$('#copy').onclick=async()=>{try{readFields();await navigator.clipboard.writeText(current.title+'\n\n'+bodyText());toast('标题、正文和话题已复制。')}catch{toast('复制失败，请手动选中文案复制。')}};
$('#show-screenshot').onclick=()=>{$('#screenshot').src=automation.screenshot;$('#screenshot-dialog').showModal()};
$('#close-screenshot').onclick=()=>$('#screenshot-dialog').close();
$('#history-list').onclick=async event=>{const button=event.target.closest('[data-resolve]');if(!button)return;try{await api('/attempts/resolve',{id:button.dataset.attempt,outcome:button.dataset.resolve});await refresh();toast('核对结果已保存。')}catch(error){toast(error.message)}};
window.addEventListener('beforeunload',event=>{if(dirty||uploading){event.preventDefault();event.returnValue=''}});
await refresh(true).catch(error=>toast('无法载入发布助手：'+error.message));
setInterval(()=>{if(!document.hidden)refresh().catch(()=>{})},2000);
