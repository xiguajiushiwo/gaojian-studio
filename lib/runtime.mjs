import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export async function getPlaywright(){
  try{return await import('playwright')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
  const bundled=path.join(process.env.USERPROFILE||process.env.HOME||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  if(fs.existsSync(bundled))return import(pathToFileURL(bundled).href);
  throw new Error('缺少浏览器运行组件。请在工具目录运行 npm install 后重试。');
}
export function edgePath(){
  return [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA].filter(Boolean).map(base=>path.join(base,'Microsoft/Edge/Application/msedge.exe')).find(p=>fs.existsSync(p));
}
