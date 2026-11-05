import { app, BrowserWindow, dialog, Menu } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { assertPublicNovelHost } from './network-security.ts'

function publicHttpsUrl(raw:string):URL {
  let url:URL
  try{url=new URL(raw)}catch{throw new Error('请输入有效的公开网页 HTTPS 地址。')}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname==='localhost'||url.hostname.endsWith('.local'))throw new Error('网页预览只允许无账号信息的公开 HTTPS 地址。')
  return url
}
function safeFileName(value:string):string{return [...value].map((character)=>character.charCodeAt(0)<32||'<>:"/\\|?*'.includes(character)?'_':character).join('').slice(0,100)||'webpage'}

export async function openNovelPreview(rawUrl:string):Promise<void>{
  const initialUrl=publicHttpsUrl(rawUrl)
  await assertPublicNovelHost(initialUrl.hostname)
  const preview=new BrowserWindow({
    width:1120,height:820,show:true,title:`BookMind 网页预览 - ${initialUrl.hostname}`,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false,partition:`novel-preview-${randomUUID()}`},
  })
  const previewSession=preview.webContents.session
  previewSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  previewSession.webRequest.onBeforeRequest(async(details,callback)=>{
    try{
      const requestUrl=new URL(details.url)
      if(requestUrl.protocol==='data:'||requestUrl.protocol==='blob:'){callback({cancel:false});return}
      if(requestUrl.protocol!=='https:'||requestUrl.username||requestUrl.password||requestUrl.port){callback({cancel:true});return}
      await assertPublicNovelHost(requestUrl.hostname)
      callback({cancel:false})
    }catch{callback({cancel:true})}
  })
  preview.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  preview.webContents.on('will-attach-webview',(event)=>event.preventDefault())
  const allowedTopLevel=(raw:string)=>{try{const url=publicHttpsUrl(raw);return url.hostname.toLowerCase()===initialUrl.hostname.toLowerCase()}catch{return false}}
  preview.webContents.on('will-navigate',(event,destination)=>{if(!allowedTopLevel(destination))event.preventDefault()})
  preview.webContents.on('will-redirect',(event,destination,_isInPlace,isMainFrame)=>{if(isMainFrame&&!allowedTopLevel(destination))event.preventDefault()})
  preview.setMenu(Menu.buildFromTemplate([{label:'网页',submenu:[{label:'保存当前页面为 HTML…',accelerator:'CmdOrCtrl+S',click:async()=>{
    if(preview.isDestroyed()||preview.webContents.isDestroyed())return
    const title=safeFileName(preview.webContents.getTitle()||initialUrl.hostname)
    const result=await dialog.showSaveDialog(preview,{title:'保存当前网页 HTML',defaultPath:path.join(app.getPath('documents'),'BookMind','Website imports',`${title}.html`),filters:[{name:'HTML 网页',extensions:['html']}]})
    if(result.canceled||!result.filePath)return
    try{await preview.webContents.savePage(result.filePath,'HTMLOnly');await dialog.showMessageBox(preview,{type:'info',message:'网页已保存',detail:'请回到 BookMind 的“AI 接入新站点”窗口，导入这份 HTML。BookMind 不会读取或复用此预览窗口的 Cookie 或验证令牌。'})}
    catch(error){await dialog.showMessageBox(preview,{type:'error',message:'保存网页失败',detail:error instanceof Error?error.message:'无法保存当前网页。'})}
  }}]}]))
  preview.on('closed',()=>undefined)
  try{await preview.loadURL(initialUrl.toString())}
  catch(error){if(!preview.isDestroyed())preview.close();throw new Error(`网页预览打开失败：${error instanceof Error?error.message:String(error)}`,{cause:error})}
}
