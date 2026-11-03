import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store,imageType} from './lib/store.mjs';
import {ExtensionPublisher} from './lib/bridge.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
export function seed(store){
 if(store.data.drafts.length)return;
 const bundled=path.join(root,'examples/anima-note.json');
 if(fs.existsSync(bundled)){
  const note=JSON.parse(fs.readFileSync(bundled,'utf8'));
  const images=note.images.map(name=>store.addImage(fs.readFileSync(path.join(root,'examples/images',path.basename(name)))).id);
  store.put({...note,images});return;
 }
 const example=path.resolve(root,'../outputs/xiaohongshu-anima-2026-11-03');
 if(!fs.existsSync(path.join(example,'发布文案.txt')))return;
 const text=fs.readFileSync(path.join(example,'发布文案.txt'),'utf8').replace(/\r/g,'');
 const title=text.split('推荐标题\n')[1]?.split('\n')[0];
 const body=text.split('正文（可直接复制）\n')[1]?.split('\n\n话题\n')[0];
 const tags=text.split('\n\n话题\n')[1]?.trim().split(/\s+/).map(x=>x.replace(/^#/,''));
 if(!title||!body||!tags)return;
 const images=fs.readdirSync(example).filter(n=>/^0[1-6]-.*\.png$/.test(n)).sort().map(n=>store.addImage(fs.readFileSync(path.join(example,n))).id);
 store.put({title,body,tags,images});
}
export function createApp({dataDir=path.join(root,'data'),publisherFactory=store=>new ExtensionPublisher(store),importExample=false}={}){
 const store=new Store(dataDir);if(importExample)seed(store);
 const publisher=publisherFactory(store),token=crypto.randomBytes(32).toString('hex');
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};
 const read=async req=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>29*1024*1024)throw new Error('上传内容太大，请逐张上传图片。');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString()||'{}')};
 const server=http.createServer(async(req,res)=>{
  const port=server.address().port,origin='http://127.0.0.1:'+port;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.headers.host!=='127.0.0.1:'+port){send(res,403,{error:'请通过本机地址打开工具。'});return}
  const url=new URL(req.url,origin),route=url.pathname;
  if(route.startsWith('/bridge/')){
   const extensionId=req.headers['x-publisher-extension'],requestOrigin=req.headers.origin;
   if(req.method==='OPTIONS'){
    if(!/^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin||'')){send(res,403,{error:'仅允许已配对的扩展连接。'});return}
    res.writeHead(204,{'Access-Control-Allow-Origin':requestOrigin,'Access-Control-Allow-Headers':'Content-Type, X-Publisher-Extension, Authorization','Access-Control-Allow-Methods':'POST','Vary':'Origin'});res.end();return;
   }
   if(!/^[a-p]{32}$/.test(extensionId||'')||(requestOrigin&&requestOrigin!=='chrome-extension://'+extensionId)||req.method!=='POST'){send(res,403,{error:'扩展请求无效。'});return}
   if(requestOrigin)res.setHeader('Access-Control-Allow-Origin',requestOrigin);
   try{
    const input=await read(req);
    if(route==='/bridge/pair'){send(res,200,publisher.pair(input.code,extensionId,input.tabId));return}
    publisher.authenticate((req.headers.authorization||'').replace(/^Bearer /,''),extensionId);
    if(route==='/bridge/poll'){send(res,200,{command:await publisher.poll()});return}
    if(route==='/bridge/result'){send(res,200,{accepted:publisher.receive(input.commandId,input.result)});return}
    if(route==='/bridge/target'){send(res,200,publisher.retarget(input.commandId,input.tabId));return}
    if(route==='/bridge/image'){
     if(!publisher.command?.public.payload.images?.includes(input.id))throw new Error('当前任务不包含这张图片。');
     const bytes=fs.readFileSync(store.imagePath(input.id));send(res,200,{base64:bytes.toString('base64'),mime:imageType(bytes).mime,name:input.id});return;
    }
    send(res,404,{error:'未知扩展操作。'});
   }catch(error){send(res,400,{error:error.message})}return;
  }
  if(req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'拒绝来自其他网站的请求。'});return}
  if(!['GET','POST','PUT'].includes(req.method)){send(res,405,{error:'不支持的请求。'});return}
  if(req.method!=='GET'&&(req.headers.origin!==origin||req.headers['x-publisher-token']!==token)){send(res,403,{error:'页面已失效，请刷新本地助手再操作。'});return}
  try{
   if(req.method==='GET'&&route==='/api/health'){send(res,200,{app:'rednote-publisher',version:'0.4.0',mode:'fill-only'});return}
   if(req.method==='GET'&&route==='/api/state'){send(res,200,{drafts:store.drafts(),attempts:store.attempts(),automation:publisher.state(),latestDelivery:store.data.latestDelivery||null});return}
   if(req.method==='GET'&&route==='/api/connection'){send(res,200,publisher.pairingInfo());return}
   if(req.method==='POST'&&route==='/api/drafts'){const input=await read(req);send(res,201,{draft:store.put(input)});return}
   if(req.method==='POST'&&route==='/api/deliveries'){if(publisher.busy)throw new Error('浏览器操作进行中，请结束后再交付新版本。');const input=await read(req);send(res,201,{draft:store.deliver(input)});return}
   const historyRoute=route.match(/^\/api\/drafts\/([a-f0-9-]{36})\/(history|restore)$/);
   if(historyRoute&&req.method==='GET'&&historyRoute[2]==='history'){send(res,200,{versions:store.history(historyRoute[1])});return}
   if(historyRoute&&req.method==='POST'&&historyRoute[2]==='restore'){if(publisher.busy)throw new Error('浏览器操作进行中，请结束后再恢复版本。');const input=await read(req);if(!Number.isSafeInteger(input.expectedVersion))throw new Error('请刷新后再恢复版本。');send(res,200,{draft:store.restore(historyRoute[1],input.version,input.expectedVersion)});return}
   const draftRoute=route.match(/^\/api\/drafts\/([a-f0-9-]{36})$/);
   if(req.method==='PUT'&&draftRoute){if(publisher.busy)throw new Error('浏览器操作中，请稍后再保存修改。');const input=await read(req);send(res,200,{draft:store.put(input,draftRoute[1])});return}
   if(req.method==='POST'&&route==='/api/images'){
    const input=await read(req);if(typeof input.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw new Error('图片格式无效。');
    send(res,201,{image:store.addImage(Buffer.from(input.base64,'base64'))});return;
   }
   if(req.method==='GET'&&route.startsWith('/api/images/')){
    const target=store.imagePath(route.slice('/api/images/'.length));
    if(!fs.existsSync(target)){send(res,404,{error:'图片不存在。'});return}
    const bytes=fs.readFileSync(target);res.writeHead(200,{'Content-Type':imageType(bytes).mime});res.end(bytes);return;
   }
   if(req.method==='GET'&&route==='/api/screenshot'){
    const file=path.join(store.root,'screenshots/latest.png');if(!fs.existsSync(file)){send(res,404,{error:'暂无截图。'});return}
    res.writeHead(200,{'Content-Type':'image/png'});fs.createReadStream(file).pipe(res);return;
   }
   if(req.method==='POST'&&route.startsWith('/api/automation/')){
    if(['/api/automation/publish','/api/automation/publish-now'].includes(route)){send(res,410,{error:'工作台现在只自动填写。请在小红书确认内容、完成设置后手动发布；刷新工作台可使用新版按钮。',code:'MANUAL_PUBLISH_REQUIRED'});return}
    if(publisher.busy)throw new Error('已有操作正在进行，请等待完成。');
    const input=await read(req),action=route.split('/').at(-1);let promise;
    if(action==='open')promise=publisher.open();
    else if(action==='inspect')promise=publisher.inspect();
    else if(action==='prepare'){store.snapshot(input.draftId);promise=publisher.prepare(input.draftId)}
    else throw new Error('未知操作。');
    promise.catch(error=>publisher.update('error',String(error.message).slice(0,300)));send(res,202,{automation:publisher.state()});return;
   }
   if(req.method==='POST'&&route==='/api/attempts/resolve'){
    if(publisher.busy)throw new Error('请等待当前操作结束，再核对结果。');
    const input=await read(req);send(res,200,{attempt:store.resolveAttempt(input.id,input.outcome)});return;
   }
   const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
   if(req.method==='GET'&&assets[route]){
    const file=assets[route],mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
    let content=fs.readFileSync(path.join(root,'public',file));
    if(route==='/')content=Buffer.from(content.toString().replace('PUBLISHER_CSRF_TOKEN',token));
    res.writeHead(200,{'Content-Type':mime+'; charset=utf-8'});res.end(content);return;
   }
   send(res,404,{error:'找不到这个页面。'});
  }catch(error){send(res,error.status||400,{error:error.message||'操作失败，请重试。',code:error.code})}
 });
 return{server,store,publisher};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp();const port=Number(process.env.PUBLISHER_PORT||4188);
 app.server.listen(port,'127.0.0.1',()=>console.log('Rednote Publisher ready: http://127.0.0.1:'+port+'/'));
 app.server.on('error',error=>{console.error('Startup failed:',error.message);process.exitCode=1});
}
