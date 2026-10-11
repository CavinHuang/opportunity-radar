import https from 'node:https';
import {Readable} from 'node:stream';
import {isIP} from 'node:net';

// Socket-level DNS pinning: TLS verifies the ORIGINAL hostname, but the TCP
// connection uses an address already checked by the RSS public-IP policy.
// Do not expose this helper as an arbitrary HTTP proxy.
export function pinnedLookup(hostname,records){
 const expected=String(hostname).toLowerCase().replace(/\.$/,'');
 const permitted=records.map(x=>({address:String(x.address),family:Number(x.family)||isIP(x.address)}));
 if(!permitted.length||permitted.some(x=>!isIP(x.address)||!([4,6].includes(x.family))))
  throw new Error('No validated address available for feed connection');
 return function lookup(host,opts,callback){
  if(typeof opts==='function'){callback=opts;opts={};}
  if(String(host).toLowerCase().replace(/\.$/,'')!==expected)
   return callback(Object.assign(new Error('Unexpected hostname in HTTPS lookup'),{code:'SOURCE_HOST_MISMATCH'}));
  const family=Number(opts?.family)||0;
  const allowed=permitted.filter(x=>!family||x.family===family);
  if(!allowed.length)return callback(Object.assign(new Error('No verified address for requested IP family'),{code:'SOURCE_IP_FAMILY'}));
  if(opts?.all)return callback(null,allowed);
  const first=allowed[0];
  return callback(null,first.address,first.family);
 };
}

/** Fetch a public HTTPS RSS URL while preventing a post-validation DNS lookup.
 * No automatic redirects: source-hub revalidates each next HTTPS URL.
 * Custom requestImpl exists solely for deterministic socket-level tests. */
export async function pinnedHttpsFetch(url,{addresses,headers={},signal,requestImpl=https.request}={}){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&parsed.port!=='443')
  throw new Error('Only standard HTTPS feeds can be pinned');
 const lookup=pinnedLookup(parsed.hostname,addresses||[]);
 return new Promise((resolve,reject)=>{
  let settled=false;
  let req;
  const onAbort=()=>req?.destroy(Object.assign(new Error('RSS connection aborted'),{name:'AbortError'}));
  req=requestImpl(parsed,{
   method:'GET',redirect:'manual',lookup,headers,
   // TLS SNI and hostname checks use parsed.hostname, never the pinned numeric address.
   servername:parsed.hostname,timeout:10000,agent:false
  },res=>{
   if(settled)return;
   settled=true;
   // Abort must remain live through body streaming, not only until headers.
   res.once('close',()=>signal?.removeEventListener('abort',onAbort));
   resolve({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,
    headers:new Headers(res.headers),body:Readable.toWeb(res)});
  });
  req.once('error',e=>{if(!settled){settled=true;signal?.removeEventListener('abort',onAbort);reject(e);}});
  req.once('timeout',()=>req.destroy(Object.assign(new Error('RSS request timed out'),{code:'SOURCE_TIMEOUT'})));
  if(signal){signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();}
  req.end();
 });
}
