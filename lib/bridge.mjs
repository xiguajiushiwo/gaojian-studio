import crypto from 'node:crypto';
import {hash,composedBody} from './store.mjs';
const attention=message=>Object.assign(new Error(message),{phase:'needs_attention'});
export class ExtensionPublisher{
 constructor(store){
  this.store=store;this.busy=false;this.prepared=null;this.command=null;this.waiter=null;this.connection=store.data.extensionConnection?{...store.data.extensionConnection,lastSeen:0}:null;
  this.status={phase:'idle',message:'连接你日常浏览器里的小红书创作页面，即可复用登录状态。',logs:store.data.automationLogs||[],canPublish:false};
  this.renewPairing();this.pairTries=[];
 }
 renewPairing(){this.pairing={code:String(crypto.randomInt(100000,1000000)),expiresAt:Date.now()+10*60*1000}}
 pairingInfo(){if(this.pairing.expiresAt<Date.now())this.renewPairing();return{...this.pairing,extensionPath:new URL('../extension',import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/,'')}}
 update(phase,message){this.status={...this.status,phase,message,canPublish:false};this.status.logs.push({time:new Date().toISOString(),message});this.status.logs=this.status.logs.slice(-20);this.store.data.automationLogs=this.status.logs;this.store.save()}
 state(){const online=!!this.connection&&Date.now()-this.connection.lastSeen<60000;return{...this.status,busy:this.busy,browserOpen:online,transport:'extension',mode:'fill-only',connectionLabel:online?'已连接当前浏览器':'扩展未连接',draftId:this.prepared?.draftId||this.status.draftId||null,preparedId:this.prepared?.id||null,canPublish:false,screenshot:null}}
 pair(code,extensionId,tabId){
  const now=Date.now();this.pairTries=this.pairTries.filter(t=>now-t<5*60*1000);
  if(this.pairTries.length>=6)throw new Error('连接码尝试次数过多，请五分钟后重试。');this.pairTries.push(now);
  if(this.busy)throw new Error('请等待当前任务完成后再切换页面。');
  if(!/^[a-p]{32}$/.test(extensionId)||!Number.isSafeInteger(tabId))throw new Error('扩展连接信息无效。');
  if(this.pairing.expiresAt<now||code!==this.pairing.code)throw new Error('连接码不正确或已过期，请在助手里重新查看。');
  if(this.waiter)this.waiter(null);
  const token=crypto.randomBytes(32).toString('hex');
  this.connection={tokenHash:hash(token),extensionId,tabId,lastSeen:now};this.store.data.extensionConnection={tokenHash:hash(token),extensionId,tabId};this.store.save();this.prepared=null;this.renewPairing();this.pairTries=[];
  this.update('connected','已连接当前浏览器。请确认小红书创作平台已登录，再自动填写。');
  return{token,tabId};
 }
 authenticate(token,extensionId){
  const c=this.connection;
  if(!c||typeof token!=='string'||hash(token)!==c.tokenHash||extensionId!==c.extensionId)throw new Error('连接已失效，请使用助手中的连接码重新连接。');
  c.lastSeen=Date.now();return c;
 }
 async poll(){
  if(this.command&&!this.command.delivered){this.command.delivered=true;return this.command.public}
  if(this.waiter)this.waiter(null);
  return new Promise(resolve=>{const done=value=>{clearTimeout(timer);if(this.waiter===done)this.waiter=null;resolve(value)};const timer=setTimeout(()=>done(null),18000);this.waiter=done});
 }
 request(type,payload={},timeout=30000){
  if(!['inspect','prepare','probe','verify'].includes(type))throw new Error('工作台仅支持自动填写，请在小红书手动发布。');
  if(!this.connection||Date.now()-this.connection.lastSeen>60000)throw attention('请先通过浏览器扩展连接小红书创作页面。');
  if(this.command)throw new Error('前一个浏览器操作尚未结束。');
  return new Promise((resolve,reject)=>{
   const publicCommand={id:crypto.randomUUID(),type,payload,tabId:this.connection.tabId};
   const timer=setTimeout(()=>{if(this.command?.public.id===publicCommand.id)this.command=null;reject(attention('没有及时收到浏览器结果。请检查创作页面和扩展连接。'))},timeout);
   this.command={public:publicCommand,delivered:false,finish:(result)=>{clearTimeout(timer);this.command=null;resolve(result)}};
   if(this.waiter){this.command.delivered=true;this.waiter(publicCommand)}
  });
 }
 receive(commandId,result){if(this.command?.public.id!==commandId)return false;this.command.finish(result);return true}
 retarget(commandId,tabId){
  const cmd=this.command;
  if(!cmd||cmd.public.id!==commandId||cmd.public.type!=='prepare'||!cmd.delivered||!Number.isSafeInteger(tabId)||tabId<0)throw new Error('当前没有可以切换编辑页的填写任务。');
  if(cmd.retargeted&&cmd.public.tabId!==tabId)throw new Error('此任务已切换过编辑页。');
  cmd.retargeted=true;cmd.public.tabId=tabId;this.connection.tabId=tabId;this.store.data.extensionConnection.tabId=tabId;this.store.save();return{ok:true};
 }
 async run(fn){
  if(this.busy)throw new Error('已有操作正在进行，请等待完成。');this.busy=true;
  try{await fn()}catch(error){this.prepared=null;this.update(error.phase||'error',String(error.message).slice(0,350))}finally{this.busy=false}
  return this.state();
 }
 async open(){return this.inspect()}
 async inspect(){return this.run(async()=>{this.update('opening','正在检查你连接的小红书页面…');const r=await this.request('inspect');if(!r.ok)throw Object.assign(new Error(r.message),{phase:r.phase||'needs_attention'});this.status.page=r.page||null;this.update(this.prepared?'prepared':'connected',this.prepared?'内容已填写，请在小红书确认设置后手动发布。':'已连接小红书创作页面。点击「填写到小红书」即可上传配图并填入文案。')})}
 async prepare(id){return this.run(()=>this.prepareDraft(id))}
 async prepareDraft(id){
  this.prepared=null;this.status.draftId=id;const snapshot=this.store.snapshot(id);this.store.checkDuplicate(snapshot.fingerprint);
  this.update('preparing','正在把草稿交给当前浏览器，上传图片并填写文案…');
  const proof=crypto.randomUUID(),r=await this.request('prepare',{proof,draftId:id,title:snapshot.draft.title,body:composedBody(snapshot.draft),images:snapshot.draft.images},150000);
  if(!r.ok)throw Object.assign(new Error(r.message),{phase:r.phase||'needs_attention'});
  this.prepared={id:proof,draftId:id,fingerprint:snapshot.fingerprint};
  this.update('prepared','配图和文案已填写，尚未发布。请在小红书检查内容、设置声明和可见范围，然后手动点击发布。');
 }
}
