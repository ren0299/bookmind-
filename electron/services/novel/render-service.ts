import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { assertPublicNovelHost, hostAllowed } from './network-security.ts'

const MAX_RENDERED_HTML=5_000_000
const NAVIGATION_TIMEOUT_MS=25_000
const DOM_SETTLE_TIMEOUT_MS=8_000

function validateRenderUrl(raw:string):URL{
  let url:URL
  try{url=new URL(raw)}catch{throw new Error('浏览器渲染收到无效网页地址。')}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hostAllowed(url.hostname))throw new Error('浏览器渲染只允许无账号信息的公开 HTTPS 页面。')
  return url
}

function cleanRenderedDomScript(expectedChapterCount?:number):string{
  return `(() => {
    const root = document.documentElement.cloneNode(true);
    if (${expectedChapterCount??'null'}) root.querySelector('body')?.prepend(document.createComment('BOOKMIND_EXPECTED_CHAPTER_COUNT:${expectedChapterCount??''}'));
    root.querySelectorAll('script,style,noscript,iframe,frame,object,embed,form,input,button,textarea,select,meta,base,link,svg,canvas,video,audio,ins,.adsbygoogle,nav,header,footer,aside').forEach(node => node.remove());
    root.querySelectorAll('*').forEach(node => {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'srcset' || name.startsWith('data-') || /token|auth|cookie|session|csrf|nonce|signature|secret|api[_-]?key/i.test(name)) node.removeAttribute(attr.name);
        else if (['href','src','action','formaction','xlink:href'].includes(name) && name !== 'href') node.removeAttribute(attr.name);
        else if (name === 'href') {
          try {
            const target = new URL(attr.value, location.href);
            if (!['https:','http:'].includes(target.protocol)) node.removeAttribute(attr.name);
            else {
              for (const key of [...target.searchParams.keys()]) if (/^(?:token|auth|authorization|cookie|session|sid|signature|sig|key|api[_-]?key|access[_-]?token|cf[_-]?clearance)$/i.test(key)) target.searchParams.delete(key);
              node.setAttribute(attr.name, /^https?:/i.test(attr.value) ? target.toString() : target.pathname + target.search + target.hash);
            }
          } catch { node.removeAttribute(attr.name); }
        }
      }
    });
    return root.outerHTML;
  })()`
}

export async function renderPublicNovelPage(rawUrl:string,expectedHost?:string,expandTwkanCatalog=false):Promise<string>{
  const url=validateRenderUrl(rawUrl),host=url.hostname.toLowerCase()
  if(expectedHost&&host!==expectedHost.toLowerCase())throw new Error('网页渲染目标与小说来源主机不一致。')
  await assertPublicNovelHost(host)
  const partition=`novel-render-${randomUUID()}`
  const pageSession=session.fromPartition(partition,{cache:false})
  const verifiedHosts=new Set([host])
  let challengeDetected=false
  let mainStatus:number|undefined
  let directoryApiStatus:number|undefined
  pageSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  pageSession.webRequest.onBeforeRequest(async(details,callback)=>{
    try{
      const requestUrl=new URL(details.url)
      if(requestUrl.protocol==='data:'||requestUrl.protocol==='blob:'){callback({cancel:false});return}
      if(requestUrl.protocol!=='https:'||requestUrl.username||requestUrl.password||requestUrl.port){callback({cancel:true});return}
      if(details.resourceType==='mainFrame'&&requestUrl.hostname.toLowerCase()!==host){callback({cancel:true});return}
      if(!verifiedHosts.has(requestUrl.hostname.toLowerCase())){await assertPublicNovelHost(requestUrl.hostname);verifiedHosts.add(requestUrl.hostname.toLowerCase())}
      callback({cancel:false})
    }catch{callback({cancel:true})}
  })
  pageSession.webRequest.onHeadersReceived({urls:['https://*/*']},(details,callback)=>{
    const challenge=Object.entries(details.responseHeaders||{}).some(([name,values])=>name.toLowerCase()==='cf-mitigated'&&values.some((value)=>value.toLowerCase()==='challenge'))
    if(challenge){challengeDetected=true;callback({cancel:true});return}
    if(details.resourceType==='mainFrame')mainStatus=details.statusCode
    if(details.url.includes('/ajax_novels/chapterlist/'))directoryApiStatus=details.statusCode
    callback({})
  })
  const window=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false,backgroundThrottling:false}})
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  window.webContents.on('will-attach-webview',(event)=>event.preventDefault())
  const navigation=window.loadURL(url.toString())
  let timeout:ReturnType<typeof setTimeout>|undefined
  try{
    await Promise.race([navigation,new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error(`浏览器加载网页超时（${NAVIGATION_TIMEOUT_MS/1000} 秒）。`)),NAVIGATION_TIMEOUT_MS)})])
    if(challengeDetected)throw new Error(`目标网站（${host}）的浏览器响应带有 Cloudflare 挑战标记。BookMind 已在渲染挑战页前停止，没有尝试自动验证或继续访问。`)
    if(typeof mainStatus==='number'&&mainStatus>=400)throw new Error(`目标网站浏览器请求返回 HTTP ${mainStatus}（${host}）。`)
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      let previous = '';
      let stable = 0;
      const start = Date.now();
      const timer = setInterval(() => {
        const current = document.body?.innerText || '';
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        if ((Date.now() - start >= 1000 && stable >= 2) || Date.now() - start >= ${DOM_SETTLE_TIMEOUT_MS}) { clearInterval(timer); resolve(true); }
      }, 400);
    })`)
    let expectedChapterCount:number|undefined
    if(expandTwkanCatalog&&host==='twkan.com'&&/^\/book\/\d+(?:\/index\.html|\.html)?\/?$/.test(url.pathname)){
      const expansion=await window.webContents.executeJavaScript(`new Promise(resolve => {
        const bookId=location.pathname.match(/^\\/book\\/(\\d+)/)?.[1];
        const button=document.querySelector('#loadmore');
        const match=(button?.innerText||document.body?.innerText||'').match(/(?:展开|展開)全部\\s*(\\d+)\\s*(?:章|章节|章節)/i);
        const expected=match?Number(match[1]):null;
        const count=()=>Array.from(document.querySelectorAll('#allchapter ul li a[href]')).filter(a=>{try{return new URL(a.href).pathname.startsWith('/txt/'+bookId+'/')}catch{return false}}).length;
        if(!expected||!button||count()>=expected){resolve({expected,count:count()});return;}
        button.click();
        const start=Date.now();
        const timer=setInterval(()=>{const current=count();if(current>=expected||Date.now()-start>=15000){clearInterval(timer);resolve({expected,count:current});}},300);
      })`)
      expectedChapterCount=expansion.expected||undefined
      if(challengeDetected)throw new Error('TWKAN 目录展开请求遇到访问挑战，已停止。')
      if(typeof directoryApiStatus==='number'&&directoryApiStatus>=400&&!challengeDetected)throw new Error(`TWKAN 公开目录接口返回 HTTP ${directoryApiStatus}，网页展开后没有可用的完整目录。`)
    }
    const result=await window.webContents.executeJavaScript(`({html:${cleanRenderedDomScript(expectedChapterCount)},title:document.title,textLength:(document.body?.innerText||'').length,challenge:/cloudflare|just a moment|verify you are human|人机验证/i.test((document.title+' '+(document.body?.innerText||'')).slice(0,2500))})`)
    if(result.challenge)throw new Error(`目标网站（${host}）在浏览器中显示访问验证或拦截页面。BookMind 不会自动验证或绕过。`)
    if(!result.html||result.textLength<80)throw new Error(`浏览器已打开网页但没有加载出足够的公开正文（页面标题：“${String(result.title||'').slice(0,100)}”，可见文本 ${result.textLength} 字符）。可能需要用户操作或页面结构暂不支持。`)
    if(result.html.length>MAX_RENDERED_HTML)throw new Error('浏览器渲染后的网页超过 5 MB 安全限制。')
    return result.html as string
  }catch(error){
    if(challengeDetected)throw new Error(`目标网站（${host}）的浏览器响应带有 Cloudflare 挑战标记。BookMind 已在渲染挑战页前停止，没有尝试自动验证或继续访问。`,{cause:error})
    throw error
  }finally{
    if(timeout)clearTimeout(timeout)
    if(!window.isDestroyed())window.destroy()
    await pageSession.clearStorageData().catch(()=>undefined)
    await pageSession.clearCache().catch(()=>undefined)
  }
}
