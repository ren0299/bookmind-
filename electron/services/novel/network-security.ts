import { lookup } from 'node:dns/promises'

export function hostAllowed(host:string):boolean{return /^[a-z0-9.-]+$/i.test(host)&&!host.endsWith('.local')&&!host.endsWith('.localhost')&&host!=='localhost'}

function isPublicAddress(address:string):boolean{
  if(address.includes(':'))return /^[23]/i.test(address)&&!/^2001:db8:/i.test(address)
  const parts=address.split('.').map(Number)
  return parts.length===4&&parts[0]!==10&&parts[0]!==127&&parts[0]!==0&&parts[0]<224&&!(parts[0]===169&&parts[1]===254)&&!(parts[0]===172&&parts[1]>=16&&parts[1]<=31)&&!(parts[0]===192&&(parts[1]===168||parts[1]===0||parts[1]===2))&&!(parts[0]===100&&parts[1]>=64&&parts[1]<=127)&&!(parts[0]===198&&(parts[1]===18||parts[1]===19||parts[1]===51))&&!(parts[0]===203&&parts[1]===0&&parts[2]===113)
}

export async function assertPublicNovelHost(host:string):Promise<void>{
  let addresses:Array<{address:string;family:number}>
  try{addresses=await lookup(host,{all:true})}
  catch(error){
    const detail=error instanceof Error?error.message:String(error)
    const code=error&&typeof error==='object'&&'code' in error?String(error.code):'UNKNOWN'
    throw new Error(`目标网站 DNS 解析失败（${host}，${code}）：${detail.slice(0,300)}`,{cause:error})
  }
  if(!addresses.length||addresses.some((item)=>!isPublicAddress(item.address)))throw new Error('该网站解析到非公开网络地址，出于安全原因无法访问。')
}
