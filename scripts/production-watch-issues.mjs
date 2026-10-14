#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const OUTAGE='[Radar Watch] Production endpoint unhealthy';
const eventTitle=alert=>'[Radar Watch] Guard rollback '+alert.code+' @ '+
 alert.releaseRevision+' / '+alert.at;
export function planWatchIssues(report,issues=[]){
 if(!report||!['healthy','down'].includes(report.state))throw Error('INVALID_WATCH_REPORT');
 const result=[];
 const outages=issues.filter(x=>x.title===OUTAGE);
 if(report.state==='down'){
  if(!outages.some(x=>x.state==='open')){
   const previous=outages.find(x=>x.state==='closed');
   if(previous)result.push({action:'reopen',number:previous.number,
    comment:'External probe failed again: '+String(report.code||'UNKNOWN')});
   else result.push({action:'create',title:OUTAGE,
    body:'Independent GitHub Actions production probe failed.\n\nDiagnostic code: `'+
    String(report.code||'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,70)+
    '`\n\nNo Owner Token or private research data is collected. Inspect Dokploy, DNS, network and release identity.'});
  }
 }else for(const issue of outages.filter(x=>x.state==='open')){
  result.push({action:'close',number:issue.number,
   comment:'Independent external health/version probe recovered; review service history before resolving.'});
 }
 if(report.rollbackAlert&&report.monitoring==='health_and_rollback'){
  const a=report.rollbackAlert;
  if(!['APPROVAL_REVOKED','REVIEWED_REGRESSION'].includes(a.code)||
      !Number.isInteger(a.releaseRevision)||a.releaseRevision<0||
      !Number.isFinite(Date.parse(a.at)))throw Error('INVALID_ROLLBACK_ALERT');
  const title=eventTitle(a);
  if(!issues.some(x=>x.title===title))
   result.push({action:'create',title,
    body:'External read-only monitor observed a production guard rollback event.\n\n'+
     'Code: `'+a.code+'`\nRelease revision: `'+a.releaseRevision+
     '`\nEvent time: `'+a.at+
     '`\n\nThis is not proof that all user-visible requests were affected. Inspect private monitoring evidence as Owner before closing.'});
 }
 return result;
}
export async function manageWatchIssues(report,{token,repository,api='https://api.github.com',fetchImpl=fetch}={}){
 if(!token||!repository||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw Error('MISSING_GITHUB_WATCH_PERMISSIONS');
 const origin=api+'/repos/'+repository;
 const request=async(path,method='GET',body)=>{
  const response=await fetchImpl(origin+path,{method,headers:{
   Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
   'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('GITHUB_API_'+response.status+'_'+method);
  return await response.json();
 };
 const issues=[];
 for(let page=1;page<=20;page++){
  const batch=await request('/issues?state=all&per_page=100&page='+page);
  if(!Array.isArray(batch))throw Error('INVALID_ISSUE_LIST');
  issues.push(...batch.filter(x=>!x.pull_request&&typeof x.title==='string'));
  if(batch.length<100)break;
  if(page===20)throw Error('ISSUE_PAGINATION_LIMIT');
 }
 const actions=planWatchIssues(report,issues);
 for(const x of actions){
  if(x.action==='create')await request('/issues','POST',{title:x.title,body:x.body});
  if(x.action==='reopen')await request('/issues/'+x.number,'PATCH',{state:'open'});
  if(x.action==='close')await request('/issues/'+x.number,'PATCH',{state:'closed'});
  if(x.comment)await request('/issues/'+x.number+'/comments','POST',{body:x.comment});
 }
 return actions.map(x=>({action:x.action,title:x.title||null,number:x.number||null}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const file=process.env.RADAR_WATCH_REPORT||'watch-result.json';
  const report=JSON.parse(readFileSync(file,'utf8'));
  const changes=await manageWatchIssues(report,{token:process.env.GITHUB_TOKEN,
   repository:process.env.GITHUB_REPOSITORY});
  process.stdout.write(JSON.stringify({issuesUpdated:changes})+'\n');
 }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
