import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {backupDatabase,verifyBackup,restoreDatabase,inspectRadarDatabase,defaultDatabasePath,pruneEvents} from './data-safety.mjs';

const err=(code,message)=>Object.assign(new Error(message),{code});
const supported=new Set(['doctor','backup','verify','restore','prune-events']);
export function parseDataCommand(argv){
 const [command,...rest]=argv;
 if(!supported.has(command))throw err('BAD_COMMAND','Use doctor, backup, verify, restore or prune-events');
 const allowed=new Set(['db','input','output','destination','confirm','before']);
 const options={command};
 for(let i=0;i<rest.length;i++){
  const item=rest[i];
  if(!item.startsWith('--')||!allowed.has(item.slice(2))||Object.hasOwn(options,item.slice(2)))
   throw err('BAD_ARGUMENT','Unexpected or duplicate argument '+String(item));
  const name=item.slice(2);
  if(name==='confirm')options.confirm=true;
  else{const value=rest[++i];if(!value||value.startsWith('--'))throw err('BAD_ARGUMENT','Missing '+name);options[name]=value;}
 }
 return options;
}
export function runDataCommand(argv){
 const options=parseDataCommand(argv);
 if(options.command==='doctor'){
  const database=resolve(options.db||defaultDatabasePath());
  return {database,...inspectRadarDatabase(database),writableBackupConfigured:false,
    note:'Only the local DB is checked. This does not verify RSS connectivity, live Agent status or a stored backup.'};
 }
 if(options.command==='backup')return backupDatabase({database:options.db||defaultDatabasePath(),output:options.output});
 if(options.command==='verify')return verifyBackup({input:options.input});
 if(options.command==='prune-events')return pruneEvents({database:options.db||defaultDatabasePath(),before:options.before,confirmed:options.confirm===true});
 return restoreDatabase({input:options.input,destination:options.destination,confirmed:options.confirm});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const data=runDataCommand(process.argv.slice(2));
  process.stdout.write(JSON.stringify(data,null,2)+'\n');
 }catch(e){process.stderr.write((e.code||'ERROR')+': '+e.message+'\n');process.exitCode=1;}
}
