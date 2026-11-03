import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const countText=value=>[...String(value)].length;
export const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function composedBody(draft){const tags=(draft.tags||[]).map(t=>'#'+t);return draft.body.trim()+(tags.length?'\n\n'+tags.join(' '):'')}
export function validateDraft(draft,ready=false){
  if(typeof draft.title!=='string'||typeof draft.body!=='string')throw new Error('请填写有效的标题和正文。');
  if(countText(draft.title.trim())>20)throw new Error('标题最多 20 字，请缩短后再自动填写。');
  if(!Array.isArray(draft.tags)||draft.tags.length>10||draft.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40||/[#\s]/.test(t)))throw new Error('话题最多 10 个，每个话题请勿包含空格或 #。');
  if(countText(composedBody(draft))>1000)throw new Error('正文和话题合计最多 1000 字。');
  if(!Array.isArray(draft.images)||draft.images.length>18||draft.images.some(id=>!/^[-a-z0-9]+\.(png|jpg|webp)$/.test(id))||new Set(draft.images).size!==draft.images.length)throw new Error('请使用 1–18 张有效配图。');
  if(ready&&(!draft.title.trim()||!draft.body.trim()||!draft.images.length))throw new Error('自动填写前请补齐标题、正文和至少一张配图。');
  for(const [key,limit] of [['brief',4000],['category',40],['deliveryNote',1000]])if(draft[key]!==undefined&&(typeof draft[key]!=='string'||draft[key].length>limit))throw new Error('创作说明过长或格式无效。');
  return {...draft,title:draft.title.trim(),tags:[...new Set(draft.tags)]};
}
export function imageType(bytes){
  if(bytes.length<16)return null;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {ext:'png',mime:'image/png'};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {ext:'jpg',mime:'image/jpeg'};
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {ext:'webp',mime:'image/webp'};
  return null;
}
export class Store{
  constructor(root){this.root=path.resolve(root);fs.mkdirSync(path.join(this.root,'images'),{recursive:true});fs.mkdirSync(path.join(this.root,'screenshots'),{recursive:true});this.file=path.join(this.root,'library.json');this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{drafts:[],attempts:[]};
    this.data.revisions??=[];
    for(const draft of this.data.drafts){draft.version??=1;draft.brief??='';draft.category??='';draft.updatedBy??='manual';draft.deliveryNote??=''}
    for(const a of this.data.attempts)if(a.status==='submitting')a.status='uncertain';this.save();
  }
  save(){const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data,null,2));fs.renameSync(temp,this.file)}
  drafts(){return this.data.drafts.map(d=>({...d})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
  get(id){if(!/^[a-f0-9-]{36}$/.test(String(id)))throw new Error('草稿不存在。');const d=this.data.drafts.find(d=>d.id===id);if(!d)throw new Error('草稿不存在。');return structuredClone(d)}
  put(input,id=null,{source='manual',expectedVersion=input.expectedVersion}={}){
    const prior=id?this.get(id):null;
    if(prior&&expectedVersion!==undefined&&expectedVersion!==prior.version)throw Object.assign(new Error('这篇内容已有新版本，你的编辑尚未覆盖它。请先查看新版本，或将当前编辑另存为一篇。'),{status:409,code:'DRAFT_CONFLICT'});
    const d=validateDraft({title:input.title??'',body:input.body??'',tags:input.tags??[],images:input.images??[],brief:input.brief??prior?.brief??'',category:input.category??prior?.category??'',deliveryNote:input.deliveryNote??prior?.deliveryNote??''});
    for(const image of d.images)if(!fs.existsSync(this.imagePath(image)))throw new Error('配图文件不存在，请重新选择。');
    const value={...d,id:prior?.id||crypto.randomUUID(),createdAt:prior?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),version:(prior?.version||0)+1,updatedBy:source};
    if(prior){this.data.revisions.push(prior);const old=this.data.revisions.filter(r=>r.id===id);if(old.length>20){const cutoff=old.at(-20).version;this.data.revisions=this.data.revisions.filter(r=>r.id!==id||r.version>=cutoff)}}
    const index=this.data.drafts.findIndex(d=>d.id===value.id);if(index<0)this.data.drafts.push(value);else this.data.drafts[index]=value;this.save();return structuredClone(value);
  }
  history(id){const current=this.get(id);return [current,...this.data.revisions.filter(r=>r.id===id).slice().reverse()].map(r=>structuredClone(r))}
  restore(id,version,expectedVersion){const prior=this.history(id).find(r=>r.version===version);if(!prior)throw new Error('这个历史版本不存在。');return this.put({...prior,deliveryNote:'恢复自第 '+version+' 版'},id,{source:'manual',expectedVersion})}
  deliver(input){
    if(input.draftId&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1))throw new Error('更新已有内容需要提供 expectedVersion，避免覆盖正在编辑的版本。');
    const draft=this.put(input,input.draftId||null,{source:'assistant',expectedVersion:input.expectedVersion});
    this.data.latestDelivery={draftId:draft.id,version:draft.version,createdAt:draft.updatedAt};this.save();return draft;
  }
  imagePath(id){if(!/^[-a-z0-9]+\.(png|jpg|webp)$/.test(String(id)))throw new Error('图片地址无效。');return path.join(this.root,'images',id)}
  addImage(bytes){if(bytes.length>20*1024*1024)throw new Error('单张图片不能超过 20 MB。');const kind=imageType(bytes);if(!kind)throw new Error('仅支持真实的 PNG、JPG 或 WebP 图片。');const id=hash(bytes)+'.'+kind.ext;const target=this.imagePath(id);if(!fs.existsSync(target))fs.writeFileSync(target,bytes);return{id,mime:kind.mime,size:bytes.length}}
  snapshot(id){const draft=validateDraft(this.get(id),true);const files=draft.images.map(i=>this.imagePath(i));const fingerprint=hash(JSON.stringify({title:draft.title,body:composedBody(draft),images:files.map(f=>hash(fs.readFileSync(f)))}));return {draft,files,fingerprint}}
  attempts(){return this.data.attempts.slice().reverse()}
  checkDuplicate(fingerprint){const prior=this.data.attempts.find(a=>a.fingerprint===fingerprint&&['submitting','uncertain','published'].includes(a.status));if(prior)throw new Error(prior.status==='published'?'这篇内容已经发布过，为避免重复发布已停止。':'这篇内容上次的发布结果尚未确认，请先到小红书检查，再在记录中确认结果。')}
  beginAttempt(snapshot){this.checkDuplicate(snapshot.fingerprint);const a={id:crypto.randomUUID(),draftId:snapshot.draft.id,title:snapshot.draft.title,fingerprint:snapshot.fingerprint,status:'submitting',createdAt:new Date().toISOString()};this.data.attempts.push(a);this.save();return a.id}
  finishAttempt(id,status,details={}){const a=this.data.attempts.find(a=>a.id===id);if(!a)throw new Error('发布记录不存在。');Object.assign(a,details,{status,updatedAt:new Date().toISOString()});this.save();return a}
  resolveAttempt(id,outcome){const a=this.data.attempts.find(a=>a.id===id);if(!a||a.status!=='uncertain')throw new Error('这条记录不需要人工确认。');if(!['published','not_published'].includes(outcome))throw new Error('请选择核对结果。');return this.finishAttempt(id,outcome,{verifiedBy:'user'})}
}
