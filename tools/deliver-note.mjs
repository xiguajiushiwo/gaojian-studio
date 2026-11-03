import fs from 'node:fs/promises';
import path from 'node:path';
import {validateDraft} from '../lib/store.mjs';

const origin=process.env.PUBLISHER_URL||'http://127.0.0.1:4188';
const localUrl=new URL(origin);if(localUrl.protocol!=='http:'||localUrl.hostname!=='127.0.0.1')throw new Error('只能交付到本机工作台。');
async function main(){
 const args=process.argv.slice(2),html=await(await fetch(origin)).text();
 const token=html.match(/publisher-token" content="([^"]+)"/)?.[1];
 if(!token)throw new Error('本地工作台尚未启动，或此端口不是内容工作台。');
 async function api(route,data){const response=await fetch(origin+'/api'+route,data===undefined?{}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Publisher-Token':token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result}
 if(args[0]==='--list'){const state=await api('/state');console.log(JSON.stringify(state.drafts.map(d=>({id:d.id,version:d.version,title:d.title,category:d.category,updatedBy:d.updatedBy,images:d.images.length,updatedAt:d.updatedAt})),null,2));return}
 if(args[0]==='--get'){const state=await api('/state'),draft=state.drafts.find(d=>d.id===args[1]);if(!draft)throw new Error('草稿不存在。');console.log(JSON.stringify(draft,null,2));return}
 if(!args[0])throw new Error('用法：node tools/deliver-note.mjs <note.json>，或 --list / --get <draftId>');
 const file=path.resolve(args[0]),note=JSON.parse(await fs.readFile(file,'utf8'));
 validateDraft({...note,tags:note.tags||[],images:note.images||[]});
 if(note.draftId&&!Number.isSafeInteger(note.expectedVersion))throw new Error('修改稿必须包含 expectedVersion；请先 --get 查看当前版本。');
 if(note.imagePaths!==undefined){
  if(!Array.isArray(note.imagePaths)||note.imagePaths.length>18||note.imagePaths.some(p=>typeof p!=='string'))throw new Error('imagePaths 应为最多 18 个本地图片路径。');
  note.images=[];
  for(const imagePath of note.imagePaths){const bytes=await fs.readFile(path.resolve(path.dirname(file),imagePath));const {image}=await api('/images',{base64:bytes.toString('base64')});note.images.push(image.id)}
 }
 const {draft}=await api('/deliveries',{...note,tags:note.tags||[],images:note.images||[]});
 console.log(JSON.stringify({id:draft.id,version:draft.version,title:draft.title,images:draft.images.length,url:origin+'/?draft='+draft.id,message:'已送到工作台，等待预览；未触发发布。'},null,2));
}
main().catch(error=>{console.error(error.cause?.code==='ECONNREFUSED'?'本地工作台尚未启动。':error.message);process.exitCode=1});
