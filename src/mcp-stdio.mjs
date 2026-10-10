import {createInterface} from 'node:readline';
import {openDatabase} from './db.mjs';
import {createService} from './service.mjs';
import {dispatchMcp} from './mcp.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Only run stdio from a trusted local Agent. OS file access is the security boundary.
const store=openDatabase(process.env.RADAR_DB||path.join(root,'.data','radar.sqlite'));
const service=createService(store);
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of rl){
  if(!line.trim())continue;
  try{
    const message=JSON.parse(line);
    const answer=dispatchMcp(service,message,{legacy:true});
    if(answer)process.stdout.write(JSON.stringify(answer)+'\n');
  }catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');}
}
store.close();
