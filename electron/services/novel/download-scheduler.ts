import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NovelTask } from '../../../shared/types/novel.ts'
import { areAllNovelChaptersComplete } from '../../../shared/lib/novel-task-state.ts'

export type DownloadFailureKind='network'|'server'|'rate-limit'|'access'|'parse'|'permanent'

export interface DownloadSiteConfig {
  host:string
  concurrency:number
  requestIntervalSeconds:number
  maxRetries:number
  autoRetry:boolean
  source:'global'|'site'
}

export interface DownloadConfigValues {
  concurrency:number
  requestIntervalSeconds:number
  maxRetries:number
  autoRetry:boolean
}

export interface PersistedDownloadSettings {
  version:1
  global:DownloadConfigValues
  sites:Record<string,DownloadConfigValues>
  siteStates:Record<string,{pausedReason?:string;blockedUntil?:number;browserFallbackAuthorized?:boolean}>
}

export const DEFAULT_DOWNLOAD_CONFIG:DownloadConfigValues={concurrency:2,requestIntervalSeconds:3,maxRetries:3,autoRetry:true}
export const RETRY_DELAYS_MS=[5_000,15_000,30_000] as const

export function normalizeSiteHost(host:string):string {
  const raw=host.trim().toLowerCase().replace(/\.$/,'').replace(/^www\./,'')
  const labels=raw.split('.'),suffix=labels.slice(-2).join('.')
  const compoundPublicSuffixes=new Set(['co.uk','org.uk','ac.uk','com.au','net.au','org.au','co.nz','co.jp','com.br','com.cn','com.tw','com.sg','co.in','com.mx'])
  const normalized=labels.length>2?labels.slice(-(compoundPublicSuffixes.has(suffix)?3:2)).join('.'):raw
  if(!normalized||normalized.length>253||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(normalized))throw new Error('请输入有效的网站域名。')
  return normalized
}

export function defaultPersistedSettings():PersistedDownloadSettings{return {version:1,global:{...DEFAULT_DOWNLOAD_CONFIG},sites:{},siteStates:{}}}

export async function readPersistedDownloadSettings(filePath:string):Promise<PersistedDownloadSettings>{
  try{
    const parsed=JSON.parse(await readFile(filePath,'utf8')) as Partial<PersistedDownloadSettings>,defaults=defaultPersistedSettings()
    let global=defaults.global
    try{if(parsed.global)global=validateConfig({...defaults.global,...parsed.global})}catch{/* use safe defaults when the persisted global entry is invalid */}
    const sites:PersistedDownloadSettings['sites']={},siteStates:PersistedDownloadSettings['siteStates']={}
    for(const [host,value] of Object.entries(parsed.sites??{})){try{sites[normalizeSiteHost(host)]=validateConfig({...global,...value})}catch{/* ignore invalid old site entries */}}
    for(const [host,value] of Object.entries(parsed.siteStates??{})){try{let reason=typeof value?.pausedReason==='string'?value.pausedReason.slice(0,300):undefined;const prefix=reason?.match(/^(网站\s+[^\s]+\s+已暂停：)/)?.[1];if(prefix)while(reason?.startsWith(prefix+prefix))reason=reason.slice(prefix.length);siteStates[normalizeSiteHost(host)]={pausedReason:reason,blockedUntil:Number.isFinite(value?.blockedUntil)?value?.blockedUntil:undefined,browserFallbackAuthorized:value?.browserFallbackAuthorized===true}}catch{/* ignore invalid old site state */}}
    return {version:1,global,sites,siteStates}
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return defaultPersistedSettings();throw error}
}

export async function writePersistedDownloadSettings(filePath:string,settings:PersistedDownloadSettings):Promise<void>{
  await mkdir(path.dirname(filePath),{recursive:true});const temporary=`${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;await writeFile(temporary,JSON.stringify(settings,null,2),'utf8');await rename(temporary,filePath)
}

export function recoverNovelTaskAfterRestart(task:NovelTask):NovelTask{
  if (areAllNovelChaptersComplete(task)) return { ...task, status: 'completed' }
  if(task.status!=='downloading'&&task.status!=='completed')return task
  const chapters=task.chapters.map(chapter=>chapter.status==='downloading'?{...chapter,status:'pending' as const}:chapter)
  return {...task,status:chapters.some(chapter=>chapter.status==='failed')?'partially-completed':'paused',chapters}
}

export function validateConfig(values:DownloadConfigValues):DownloadConfigValues {
  if(!Number.isInteger(values.concurrency)||values.concurrency<1||values.concurrency>10)throw new Error('并发线程数必须为 1～10。')
  if(!Number.isInteger(values.requestIntervalSeconds)||values.requestIntervalSeconds<0||values.requestIntervalSeconds>5)throw new Error('请求间隔必须为 0～5 秒。')
  if(!Number.isInteger(values.maxRetries)||values.maxRetries<0||values.maxRetries>10)throw new Error('最大自动重试次数必须为 0～10。')
  if(typeof values.autoRetry!=='boolean')throw new Error('自动重试开关值无效。')
  return {...values}
}

export function effectiveSiteConfig(settings:PersistedDownloadSettings,host:string):DownloadSiteConfig {
  const normalized=normalizeSiteHost(host),site=settings.sites[normalized]
  return {host:normalized,...(site??settings.global),source:site?'site':'global'}
}

export class NovelDownloadError extends Error {
  readonly kind:DownloadFailureKind
  readonly status?:number
  readonly retryAfterMs?:number
  constructor(kind:DownloadFailureKind,message:string,status?:number,retryAfterMs?:number,options?:ErrorOptions){super(message,options);this.kind=kind;this.status=status;this.retryAfterMs=retryAfterMs;this.name='NovelDownloadError'}
}

export function retryAfterMilliseconds(header:string| null,now=Date.now()):number|undefined {
  if(!header)return undefined
  const seconds=Number(header.trim())
  if(Number.isFinite(seconds)&&seconds>=0)return Math.min(seconds*1000,24*60*60*1000)
  const date=Date.parse(header)
  return Number.isFinite(date)?Math.min(Math.max(0,date-now),24*60*60*1000):undefined
}

export function classifyDownloadFailure(error:unknown):NovelDownloadError {
  if(error instanceof NovelDownloadError)return error
  const message=error instanceof Error?error.message:String(error)
  const code=error&&typeof error==='object'&&'code' in error?String((error as {code?:unknown}).code??''):''
  if(/HTTP\s*429|rate.?limit|too many requests/i.test(message))return new NovelDownloadError('rate-limit',message,429)
  if(/HTTP\s*403|cloudflare|captcha|challenge|access denied|just a moment|访问限制|人机验证|拒绝访问/i.test(message))return new NovelDownloadError('access',message,403)
  if(/HTTP\s*5\d\d/i.test(message))return new NovelDownloadError('server',message)
  if(/fetch failed|network|timeout|timed out|aborted|网络连接失败|连接超时|DNS 解析失败|代理连接失败|TLS 证书验证失败|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|UND_ERR/i.test(`${code} ${message}`))return new NovelDownloadError('network',message,undefined,undefined,{cause:error})
  return new NovelDownloadError('parse',message,undefined,undefined,{cause:error})
}

export function assertNoAccessChallenge(html:string,host:string):void{
  const visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,8000)
  if(/too many requests|rate.?limit|访问频繁|请求过于频繁/i.test(visible))throw new NovelDownloadError('rate-limit',`${host} 显示请求频率限制页面。`,429,60_000)
  if(/just a moment|verify you are human|checking your browser|cf-chl-|cloudflare.{0,40}(?:challenge|verification)|captcha|access denied|人机验证|安全验证/i.test(visible))throw new NovelDownloadError('access',`${host} 返回了访问验证或拦截页面，网站下载已暂停。`,403)
}

export function retryDelayMs(retryCount:number):number {
  return RETRY_DELAYS_MS[Math.min(Math.max(0,retryCount),RETRY_DELAYS_MS.length-1)]
}

export function isChapterEligible(chapter:{status:string;retryAt?:number},retryOnly:boolean,now=Date.now()):boolean{
  if(chapter.status==='completed'||chapter.status==='downloading')return false
  if(retryOnly)return chapter.status==='failed'||(chapter.status==='retry-wait'&&(chapter.retryAt??0)<=now)
  return chapter.status==='pending'||(chapter.status==='retry-wait'&&(chapter.retryAt??0)<=now)
}

interface HostRuntime {active:number;nextStartAt:number;blockedUntil:number;pausedReason:string|null;activeUrls:Set<string>;waiters:Set<()=>void>}
export interface HostLeaseOptions {concurrency:number;requestIntervalSeconds:number;cancelled?:()=>boolean}
export class SiteRequestScheduler {
  private readonly hosts=new Map<string,HostRuntime>()
  private runtime(host:string):HostRuntime {
    const normalized=normalizeSiteHost(host);let state=this.hosts.get(normalized)
    if(!state){state={active:0,nextStartAt:0,blockedUntil:0,pausedReason:null,activeUrls:new Set(),waiters:new Set()};this.hosts.set(normalized,state)}
    return state
  }
  private notify(state:HostRuntime):void{for(const wake of state.waiters)wake();state.waiters.clear()}
  setPersistedState(host:string,pausedReason?:string,blockedUntil?:number):void {const state=this.runtime(host);state.pausedReason=pausedReason||null;state.blockedUntil=Math.max(state.blockedUntil,blockedUntil||0);this.notify(state)}
  pauseSite(host:string,reason:string):void{const state=this.runtime(host);state.pausedReason=reason;this.notify(state)}
  blockUntil(host:string,timestamp:number):void{const state=this.runtime(host);state.blockedUntil=Math.max(state.blockedUntil,timestamp);this.notify(state)}
  resumeSite(host:string):void{const state=this.runtime(host);state.pausedReason=null;state.blockedUntil=0;this.notify(state)}
  wake(host:string):void{this.notify(this.runtime(host))}
  siteStatus(host:string):{pausedReason:string|null;blockedUntil:number}{const state=this.runtime(host);return {pausedReason:state.pausedReason,blockedUntil:state.blockedUntil}}
  async acquire(host:string,url:string,options:HostLeaseOptions):Promise<()=>void>{
    const normalized=normalizeSiteHost(host),state=this.runtime(normalized),requestUrl=new URL(url);requestUrl.hash='';const key=requestUrl.toString()
    while(true){
      if(options.cancelled?.())throw new NovelDownloadError('permanent','下载任务已暂停或取消。')
      if(state.pausedReason)throw new NovelDownloadError('access',`网站 ${normalized} 已暂停：${state.pausedReason}`)
      const now=Date.now(),waitFor=Math.max(state.blockedUntil-now,state.nextStartAt-now,0)
      if(!waitFor&&state.active<options.concurrency&&!state.activeUrls.has(key)){
        state.active+=1;state.activeUrls.add(key);state.nextStartAt=now+options.requestIntervalSeconds*1000
        let released=false
        return ()=>{if(released)return;released=true;state.active=Math.max(0,state.active-1);state.activeUrls.delete(key);this.notify(state)}
      }
      let wake!:()=>void;const event=new Promise<void>(resolve=>{wake=resolve;state.waiters.add(wake)})
      if(waitFor>0)await Promise.race([event,new Promise<void>(resolve=>setTimeout(resolve,waitFor))])
      else await event
    }
  }
}

