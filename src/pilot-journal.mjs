import {mkdirSync,lstatSync,openSync,writeFileSync,closeSync,renameSync,unlinkSync,readdirSync,readFileSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';

const validId=/^[a-f0-9-]{36}$/i;
const error=(code,message)=>Object.assign(new Error(message),{code});
export const defaultJournalDir=()=>join(homedir(),'.opportunity-radar','runs');

function directory(path){
 const dest=resolve(path||defaultJournalDir());
 mkdirSync(dest,{recursive:true,mode:0o700});
 const st=lstatSync(dest);
 if(!st.isDirectory()||st.isSymbolicLink())throw error('UNSAFE_JOURNAL','Run receipt location must be a real directory');
 // This is local audit metadata, not a location for other users to read.
 chmodSync(dest,0o700);
 return dest;
}
const safe=(value,max=512)=>String(value??'').slice(0,max);
export function receiptSummary(item){
 // Explicit allowlist: never serialize bearer tokens, prompt text, model stdout,
 // client env, complete source diffs or private research observations.
 return {
  id:safe(item.id,40),projectId:safe(item.projectId,128),taskId:safe(item.taskId,128),
  provider:safe(item.provider,24),baselineRevision:Number(item.baselineRevision)||null,
  branch:safe(item.branch,160),startedAt:safe(item.startedAt,40),
  endedAt:item.endedAt?safe(item.endedAt,40):null,
  status:safe(item.status,35),
  exitCode:Number.isInteger(item.exitCode)?item.exitCode:null,
  terminationReason:item.terminationReason?safe(item.terminationReason,80):null,
  headBefore:safe(item.headBefore,40),headAfter:item.headAfter?safe(item.headAfter,40):null,
  changedFileCount:Number.isInteger(item.changedFileCount)?item.changedFileCount:null,
  manualReviewRequired:true,deliverySubmitted:false,
  warning:'Locally recorded pilot execution. A run record is not authenticated evidence of finished software, CI, or customer demand.'
 };
}
export function saveRunReceipt(item,{dir}={}){
 if(!validId.test(item.id||''))throw error('INVALID_RUN_ID','Run receipt requires a UUID');
 const dest=directory(dir),file=join(dest,'run-'+item.id+'.json'),tmp=file+'.tmp-'+process.pid;
 let fd;
 try{
  fd=openSync(tmp,'wx',0o600);
  writeFileSync(fd,JSON.stringify(receiptSummary(item),null,2)+'\n',{encoding:'utf8'});
  closeSync(fd);fd=undefined;
  renameSync(tmp,file);
 }finally{
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(tmp);}catch{}
 }
 return file;
}
export function listRunReceipts({projectId,dir,limit=20}={}){
 const dest=resolve(dir||defaultJournalDir());
 try{if(!lstatSync(dest).isDirectory()||lstatSync(dest).isSymbolicLink())throw error('UNSAFE_JOURNAL','Invalid local journal directory');}
 catch(e){if(e.code==='ENOENT')return [];throw e;}
 const output=[];
 for(const name of readdirSync(dest)){
  if(!/^run-[0-9a-f-]{36}\.json$/i.test(name))continue;
  const path=join(dest,name);
  try{
   const fileStat=lstatSync(path);
   if(!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.size>16_384)continue;
   const item=JSON.parse(readFileSync(path,'utf8'));
   if(projectId&&item.projectId!==projectId)continue;
   output.push(receiptSummary(item));
  }catch{} // One corrupt or incomplete record must not break the status command.
 }
 return output.sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,Math.max(1,Math.min(100,limit)));
}
