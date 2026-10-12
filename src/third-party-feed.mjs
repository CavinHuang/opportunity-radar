// Explicit, user-controlled third-party feed templates. Never bypass platform access controls.
const err=(code,message)=>Object.assign(new Error(message),{code,status:400});
export function makeCommunityFeed({provider,community,instance='https://rsshub.app',account, trustedInstances=process.env.RADAR_RSSHUB_TRUSTED_HOSTS||''}={}){
 if(provider==='openrss-reddit'){
  const name=String(community||'').trim().replace(/^r\//i,'');
  if(!/^[A-Za-z0-9_]{2,21}$/.test(name))throw err('INVALID_COMMUNITY','Reddit 社区只能包含 2-21 个字母数字或下划线');
  return {url:'https://openrss.org/www.reddit.com/r/'+name+'/',title:'Open RSS · r/'+name,provider:'openrss',upstream:'reddit',accessMode:'experimental_rss'};
 }
 if(provider==='rsshub-x'){
  const handle=String(account||'').trim().replace(/^@/,'');
  if(!/^[A-Za-z0-9_]{1,15}$/.test(handle))throw err('INVALID_ACCOUNT','X 账号名只能包含 1-15 个字母数字或下划线');
  let host;try{host=new URL(instance)}catch{throw err('INVALID_INSTANCE','无效的 RSSHub 实例地址')}
  if(host.protocol!=='https:'||host.username||host.password||host.port||host.search||host.hash||host.pathname!=='/')throw err('INVALID_INSTANCE','仅允许根路径 HTTPS RSSHub 实例');
  const allowed=new Set(['rsshub.app',...String(trustedInstances).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)]);
  if(!allowed.has(host.hostname.toLowerCase()))throw err('UNTRUSTED_INSTANCE','RSSHub 实例未进入服务端可信名单 RADAR_RSSHUB_TRUSTED_HOSTS');
  if(/^(localhost|.*\.local|.*\.internal)$/i.test(host.hostname)||/^\d+\.\d+\.\d+\.\d+$/.test(host.hostname))throw err('UNTRUSTED_INSTANCE','不可将 RSSHub 实例设为内网、本机或 IP 地址');
  return {url:host.origin+'/twitter/user/'+handle,title:'RSSHub · @'+handle,provider:'rsshub',upstream:'x',accessMode:'experimental_rss'};
 }
 throw err('INVALID_PROVIDER','不支持的第三方信息源');
}
