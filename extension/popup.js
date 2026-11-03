const code=document.querySelector('#code'),button=document.querySelector('#connect'),status=document.querySelector('#status');
button.onclick=async()=>{
 if(!/^\d{6}$/.test(code.value.trim())){status.textContent='请输入发布台显示的 6 位连接码。';return}
 button.disabled=true;
 try{const r=await chrome.runtime.sendMessage({type:'connect',code:code.value.trim()});status.textContent=r.message||r.error||'连接失败。'}catch{status.textContent='本地发布台尚未启动，请先双击启动文件。'}
 finally{button.disabled=false}
};
chrome.runtime.sendMessage({type:'status'}).then(r=>{if(r.error)status.textContent=r.error;else if(r.connected)status.textContent='此浏览器已连接发布台。'}).catch(()=>{});
