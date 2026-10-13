import {discoveryQualityReport as problemDiscoveryQualityReport,labelDiscoveryExample} from './discovery-quality-evaluation.mjs';
import {opportunityDiscoveryBenchmark,opportunityBenchmarkHistory,captureOpportunityBenchmark} from './opportunity-discovery-benchmark.mjs';
import {ruleTrialLedger,decideRuleTrial} from './discovery-rule-approval.mjs';
import {shadowStatus,setShadowStatus,evaluateShadow,recordShadowSnapshot,shadowHistory} from './discovery-shadow.mjs';
import {releasePreflight,releasePreflightHistory,captureReleasePreflight} from './discovery-release-preflight.mjs';
import {productionRuleStatus,changeProductionRule} from './discovery-production-release.mjs';
import {productionMonitorReport,productionMonitorHistory,captureProductionMonitor} from './discovery-production-monitor.mjs';
import {createProductionGuard} from './discovery-production-guard.mjs';
import {problemSourceDiagnostics} from './problem-source-diagnostics.mjs';
import {problemWorkQueue} from './problem-work-queue.mjs';
import {decisionReviewCenter,saveDecisionReview} from './problem-decision-center.mjs';
import {experimentExecutionBoard,recordExperimentResult,closeExperiment} from './problem-execution.mjs';
import {problemExperimentDesigns,designProblemExperiment} from './problem-experiments.mjs';
import {interviewBoard,createInterviewPlan,addInterviewObservation,decideInterviewPlan} from './problem-interviews.mjs';
import {verificationContext,verifyProblem} from './problem-verification.mjs';
import {splitOpportunityIdentity,opportunityIdentityDossier,opportunityIdentityIndex} from './opportunity-identity.mjs';
import {reviewHomeOpportunity,homeDiscoveryDashboard,decideHomeOpportunity,scanHomeOpportunities,homeOpportunitySnapshot} from './home-opportunities.mjs';
import {scorecardConfig,updateScorecardConfig,opportunityScoreboard} from './opportunity-scorecard.mjs';
import {draftOpportunityResearch,recordResearchReview} from './opportunity-research.mjs';
import {opportunityStage} from './opportunity-stages.mjs';
import {opportunityResearchWorkbench} from './opportunity-research-workbench.mjs';
import {evidenceReviewBoard,reviewExternalEvidence} from './opportunity-evidence-review.mjs';
import {alternativeResearchBoard,recordAlternativeResearch} from './opportunity-alternative-research.mjs';
import {opportunityCompetitionSpace} from './opportunity-competition-space.mjs';
import {opportunityFeasibilityBoard,saveOpportunityFeasibility} from './opportunity-feasibility.mjs';
import {investigateExternalEvidence,externalResearchBrief} from './opportunity-external-research.mjs';
import {sourceOperations} from './source-operations.mjs';
import {makeCommunityFeed} from './third-party-feed.mjs';
import {opportunityScanCandidates} from './opportunity-scan.mjs';
import {experimentDecisionReview} from './experiment-decision.mjs';
import {projectOwnerTasks,upsertOwnerTask,ownerTaskHistory,ownerTaskBoard,ownerTaskTimeline,archiveOwnerTask,unarchiveOwnerTask} from './owner-tasks.mjs';
import {createCampaign,adjustCampaign,cancelCampaign,completeCampaign,recordRetrospective,campaignOverview} from './campaign.mjs';
import {projectPipeline} from './project-pipeline.mjs';
import {buildReviewDraft,createOpportunityReview,decideOpportunityReview,opportunityReviews,reviewSummary} from './opportunity-review.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { createService } from './service.mjs';
import { verifyGitHubEvidence } from './github.mjs';
import { agentSetupSummary } from './agent-setup.mjs';
import {configuredFeeds, analyzeSignal, draftLaunchContent} from './signals.mjs';
import {seedConfiguredSources,addFeed,editFeed,scanSources,sourceHealth,sourceDiagnostics,probeFeed,retryFailedFeed,addManualSignal,triageSignal,bulkTriageSignals,querySignals} from './source-hub.mjs';
import {applyMuteRules,createMuteRule,deleteMuteRule,muteRules} from './mute-rules.mjs';
import {dispatchMcp,validateModernMcp} from './mcp.mjs';
import {createSourceScheduler} from './source-scheduler.mjs';
import {catalogList,installCatalogFeed} from './source-catalog.mjs';
import {researchReport,reviewOpportunityEvidence} from './research.mjs';
import {validationOverview,validationSummary,createValidationPlan,recordValidationObservation,closeValidationPlan} from './validation.mjs';
import {feedbackOverview,recordProductFeedback} from './delivery-trace.mjs';
import {sourceQualityReport} from './source-quality.mjs';
import {discoveryClusters,reviewDiscoveryCluster,discoveryQualityReport} from './discovery.mjs';
import {readinessSummary} from './data-safety.mjs';
import {growthOverview,growthReport,createGrowthChannel,createGrowthCampaign,recordGrowthMetric,importGrowthMetrics,reviseGrowthMetric,retractGrowthMetric,verifyGrowthMetric,growthHistory} from './growth.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dbPath=process.env.RADAR_DB||path.join(root,'.data','radar.sqlite');
// RADAR_PORT 优先；PORT 兜底以兼容 Dokploy 等 PaaS 平台的端口注入惯例。
const port=Number(process.env.RADAR_PORT||process.env.PORT||4177),host=process.env.RADAR_HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.RADAR_OWNER_TOKEN)throw new Error('RADAR_OWNER_TOKEN is required when binding to a non-loopback host');
const store=openDatabase(dbPath);seedConfiguredSources(store);const service=createService(store);
let storeClosed=false;
/** Release the module-level SQLite handle. Windows cannot delete files that are
 * still open, so test teardown calls this before removing its temporary directory. */
export function closeStore(){if(storeClosed)return;storeClosed=true;store.close();}
const files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/i18n.js':'i18n.js'};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
/** Length-safe constant-time comparison so token checks do not leak the secret
 * byte by byte through early-exit string comparison. */
function tokenMatches(received,expected){
  const a=Buffer.from(String(received??''),'utf8'),b=Buffer.from(String(expected??''),'utf8');
  if(a.length!==b.length){ // compare against a dummy of the same length to keep timing flat
    timingSafeEqual(b,b);return false;}
  return timingSafeEqual(a,b);
}
function authorize(req,role){
  if(role==='agent'){const expected=process.env.RADAR_AGENT_TOKEN;if(!expected||!tokenMatches(req.headers.authorization,`Bearer ${expected}`))throw Object.assign(new Error('Agent token missing or invalid'),{code:'UNAUTHORIZED',status:401});return;}
  if(process.env.RADAR_OWNER_TOKEN&&!tokenMatches(req.headers['x-radar-owner-key'],process.env.RADAR_OWNER_TOKEN))throw Object.assign(new Error('Owner token missing or invalid'),{code:'UNAUTHORIZED',status:401});
}
async function body(req){let buff='';for await(const chunk of req){buff+=chunk;if(buff.length>300000)throw Object.assign(new Error('Request too large'),{status:413,code:'PAYLOAD_TOO_LARGE'});}try{return buff?JSON.parse(buff):{};}catch{throw Object.assign(new Error('Invalid JSON'),{status:400,code:'BAD_JSON'});}}
/** Optional owner-side idempotency: when the client supplies an Idempotency-Key
 * header, the write is deduplicated per (key, method, path, body). Without the
 * header behavior is unchanged, so deliberately recording the same metric twice
 * stays possible. */
async function ownerWrite(req,pathname,handler){
  const key=req.headers['idempotency-key'];
  if(typeof key!=='string'||!key)return handler(await body(req));
  if(key.length>200)throw Object.assign(new Error('Idempotency-Key 过长'),{status:400,code:'BAD_REQUEST'});
  const args=await body(req);
  const signature=createHash('sha256').update(`${req.method} ${pathname}\n${JSON.stringify(args)}`).digest('hex');
  return store.idempotent('owner',key,()=>handler(args),signature);
}
const LOOPBACK_HOSTNAMES=new Set(['127.0.0.1','localhost','::1']);
/** Hostname part of a Host header value ("[::1]:4177" → "::1"). */
function hostNameOf(header){const h=String(header||'').trim().toLowerCase();if(h.startsWith('[')){const end=h.indexOf(']');return end>0?h.slice(1,end):h;}const i=h.lastIndexOf(':');return i>0?h.slice(0,i):h;}
/** DNS-rebinding guard: without an owner token, only loopback (or explicitly
 * allow-listed) Host values may reach this server. A rebound domain that
 * resolves to 127.0.0.1 still sends its own hostname in Host/Origin, so both
 * matching would otherwise pass the Origin check and expose the local API. */
function guardHost(req){
  if(process.env.RADAR_OWNER_TOKEN)return;
  const name=hostNameOf(req.headers.host);
  const allowed=(process.env.RADAR_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(LOOPBACK_HOSTNAMES.has(name)||allowed.includes(name))return;
  throw Object.assign(new Error('Host 不是 loopback 且未配置 RADAR_OWNER_TOKEN，已拒绝该请求（DNS rebinding 防护；如确需其他主机名请设置 RADAR_ALLOWED_HOSTS）'),{status:403,code:'HOST_DENIED'});
}
function protectOrigin(req){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return;
  const origin=req.headers.origin; if(!origin)return; const url=new URL(origin);const target=req.headers.host;
  if(url.host!==target)throw Object.assign(new Error('Origin mismatch'),{status:403,code:'ORIGIN_DENIED'});
}
export function createServer(){return http.createServer(async(req,res)=>{
  try{
    guardHost(req);
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);const pathname=u.pathname;
    if(files[pathname]&&req.method==='GET'){const filename=path.join(root,'public',files[pathname]);const content=await readFile(filename);res.writeHead(200,{'Content-Type':mime[path.extname(filename)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});return res.end(content);}
    if(pathname==='/api/health')return send(res,200,{ok:true,mode:'local-first',agentEnabled:Boolean(process.env.RADAR_AGENT_TOKEN),githubVerificationEnabled:Boolean(process.env.GITHUB_TOKEN),feedCount:store.list('feeds').filter(x=>x.enabled).length,sourceHealth:sourceHealth(store),llmEnabled:Boolean(process.env.RADAR_LLM_BASE_URL&&process.env.RADAR_LLM_MODEL&&process.env.RADAR_LLM_API_KEY)});
    protectOrigin(req);
    if(pathname==='/mcp'&&req.method==='POST'){
      authorize(req,'agent');const input=await body(req);
      const invalid=validateModernMcp(input,req.headers);
      if(invalid)return send(res,invalid.status,{jsonrpc:'2.0',id:input?.id??null,error:{code:invalid.code,message:invalid.message,...(invalid.data?{data:invalid.data}:{})}});
      const reply=dispatchMcp(service,input);
      if(!reply){res.writeHead(202);return res.end();}
      return send(res,reply.error?.code===-32601?404:200,reply);
    }
    if(pathname==='/api/agent/tools'&&req.method==='GET'){authorize(req,'agent');return send(res,200,{tools:service.tools});}
    const agentTool=/^\/api\/agent\/tools\/([\w.]+)$/.exec(pathname);
    if(agentTool&&req.method==='POST'){authorize(req,'agent');return send(res,200,{result:service.tool(agentTool[1],await body(req))});}
    if(!pathname.startsWith('/api/'))return send(res,404,{error:'NOT_FOUND'});
    authorize(req,'owner');
    if(pathname==='/api/operations/readiness'&&req.method==='GET')return send(res,200,readinessSummary(store,{ownerProtected:Boolean(process.env.RADAR_OWNER_TOKEN)}));
    if(pathname==='/api/source-operations'&&req.method==='GET')return send(res,200,sourceOperations(store));
    if(pathname==='/api/source-quality'&&req.method==='GET')return send(res,200,sourceQualityReport(store));
    if(pathname==='/api/home/problem-quality'&&req.method==='GET')return send(res,200,problemDiscoveryQualityReport(store));
    if(pathname==='/api/discovery/clusters'&&req.method==='GET'){
      return send(res,200,discoveryClusters(store,{includeDismissed:u.searchParams.get('include_dismissed')==='1'}));
    }
    const discoveryReview=/^\/api\/discovery\/clusters\/([a-zA-Z0-9_-]+)\/review$/.exec(pathname);
    if(discoveryReview&&req.method==='POST')return send(res,200,{item:reviewDiscoveryCluster(store,discoveryReview[1],await body(req))});
    const discoveryLink=/^\/api\/discovery\/clusters\/([a-zA-Z0-9_-]+)\/link$/.exec(pathname);
    if(discoveryLink&&req.method==='POST')return send(res,200,service.linkDiscoveryCluster(discoveryLink[1],await body(req)));
    if(pathname==='/api/source-catalog'&&req.method==='GET')return send(res,200,{items:catalogList(store)});
    if(pathname==='/api/source-catalog/install'&&req.method==='POST'){const data=await body(req);return send(res,200,installCatalogFeed(store,data.id,{acceptExperimentalRisk:data.acceptExperimentalRisk===true}));}
    if(pathname==='/api/sources/diagnostics'&&req.method==='GET')return send(res,200,sourceDiagnostics(store,{limit:u.searchParams.get('limit')??8}));
    const probeRoute=/^\/api\/sources\/([^/]+)\/probe$/.exec(pathname);
    if(probeRoute&&req.method==='POST')return send(res,200,{result:await probeFeed(store,probeRoute[1])});
    const retryRoute=/^\/api\/sources\/([^/]+)\/retry$/.exec(pathname);
    if(retryRoute&&req.method==='POST')return send(res,200,{result:await retryFailedFeed(store,retryRoute[1],await body(req))});
    if(pathname==='/api/sources'&&req.method==='GET')return send(res,200,{items:store.list('feeds').sort((a,b)=>a.title.localeCompare(b.title)),health:sourceHealth(store)});
    if(pathname==='/api/sources/third-party'&&req.method==='POST'){
      const data=await body(req);
      if(data.acceptExperimentalRisk!==true)throw Object.assign(new Error('必须明确确认第三方订阅风险'),{code:'RISK_ACK_REQUIRED',status:409});
      const template=makeCommunityFeed(data);
      const feed=addFeed(store,{url:template.url,title:template.title,market:'International',intervalMinutes:1440});
      const saved=store.put('feeds',{...feed,provider:template.provider,upstream:template.upstream,accessMode:template.accessMode,enabled:false,sourceCaution:'第三方实验接口可能不可用。需实际探测并在符合平台授权和条款时启用'},feed.revision);
      return send(res,201,{item:saved});
    }
    if(pathname==='/api/sources'&&req.method==='POST')return send(res,201,{item:addFeed(store,await body(req))});
    const source=/^\/api\/sources\/([^/]+)$/.exec(pathname);
    if(source&&req.method==='PATCH')return send(res,200,{item:editFeed(store,source[1],await body(req))});
    if(pathname==='/api/signals'&&req.method==='GET'){
      const result=querySignals(store,{status:u.searchParams.get('status')||'all',sourceId:u.searchParams.get('source_id')||'',keyword:u.searchParams.get('q')||'',offset:Number(u.searchParams.get('offset')||0),limit:Number(u.searchParams.get('limit')||30)});
      return send(res,200,{...result,configuredFeedCount:store.list('feeds').filter(x=>x.enabled).length});
    }
    if(pathname==='/api/signals/manual'&&req.method==='POST')return send(res,201,{item:addManualSignal(store,await body(req))});
    if(pathname==='/api/discovery/quality'&&req.method==='GET')return send(res,200,discoveryQualityReport(store));
    if(pathname==='/api/discovery/opportunity-benchmark'&&req.method==='GET')return send(res,200,{report:opportunityDiscoveryBenchmark(store),history:opportunityBenchmarkHistory(store)});
    if(pathname==='/api/discovery/opportunity-benchmark'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>captureOpportunityBenchmark(store,d)));
    if(pathname==='/api/discovery/rule-trials'&&req.method==='GET')return send(res,200,ruleTrialLedger(store));
    if(pathname==='/api/discovery/shadow'&&req.method==='GET')return send(res,200,{status:shadowStatus(store),preview:evaluateShadow(store)});
    if(pathname==='/api/discovery/shadow/history'&&req.method==='GET')return send(res,200,shadowHistory(store));
    if(pathname==='/api/discovery/release-preflight'&&req.method==='GET')return send(res,200,{report:releasePreflight(store),history:releasePreflightHistory(store)});
    if(pathname==='/api/discovery/production-rule'&&req.method==='GET')return send(res,200,productionRuleStatus(store));
    if(pathname==='/api/discovery/production-monitor'&&req.method==='GET')return send(res,200,{report:productionMonitorReport(store),history:productionMonitorHistory(store),alerts:store.eventsLatest(100).filter(e=>e.kind==='discovery.production_guard.alert').slice(-20).reverse()});
    if(pathname==='/api/discovery/production-monitor'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>captureProductionMonitor(store,d)));
    if(pathname==='/api/discovery/production-rule'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>changeProductionRule(store,d)));
    if(pathname==='/api/discovery/release-preflight'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>captureReleasePreflight(store,d)));
    if(pathname==='/api/discovery/shadow'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>d.action==='snapshot'?recordShadowSnapshot(store,d):setShadowStatus(store,d)));
    if(pathname==='/api/discovery/rule-trials'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>decideRuleTrial(store,d)));
    const qualityLabel=/^\/api\/home\/problem-quality\/([^/]+)$/.exec(pathname);
    if(qualityLabel&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>labelDiscoveryExample(store,decodeURIComponent(qualityLabel[1]),d))});
    if(pathname==='/api/home/source-diagnostics'&&req.method==='GET')return send(res,200,problemSourceDiagnostics(store));
    if(pathname==='/api/home/work-queue'&&req.method==='GET')return send(res,200,problemWorkQueue(store));
    if(pathname==='/api/decision-center'&&req.method==='GET')return send(res,200,decisionReviewCenter(store));
    const reviewDecision=/^\/api\/decision-center\/([^/]+)$/.exec(pathname);
    if(reviewDecision&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>saveDecisionReview(store,decodeURIComponent(reviewDecision[1]),d))});
    const experimentRun=/^\/api\/problem-execution\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
    if(experimentRun&&req.method==='GET')return send(res,200,experimentExecutionBoard(store,...experimentRun.slice(1).map(decodeURIComponent)));
    if(experimentRun&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>recordExperimentResult(store,...experimentRun.slice(1).map(decodeURIComponent),d))});
    const experimentClose=/^\/api\/problem-execution\/([^/]+)\/([^/]+)\/([^/]+)\/close$/.exec(pathname);
    if(experimentClose&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>closeExperiment(store,...experimentClose.slice(1).map(decodeURIComponent),d))});
    const experimentDesign=/^\/api\/problem-experiments\/([^/]+)\/([^/]+)$/.exec(pathname);
    if(experimentDesign&&req.method==='GET')return send(res,200,problemExperimentDesigns(store,decodeURIComponent(experimentDesign[1]),decodeURIComponent(experimentDesign[2])));
    if(experimentDesign&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>designProblemExperiment(store,decodeURIComponent(experimentDesign[1]),decodeURIComponent(experimentDesign[2]),d))});
    const interviewRoute=/^\/api\/problem-interviews\/([^/]+)$/.exec(pathname);
    if(interviewRoute&&req.method==='GET')return send(res,200,interviewBoard(store,decodeURIComponent(interviewRoute[1])));
    if(interviewRoute&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>createInterviewPlan(store,decodeURIComponent(interviewRoute[1]),d))});
    const interviewObservation=/^\/api\/problem-interviews\/([^/]+)\/([^/]+)\/observations$/.exec(pathname);
    if(interviewObservation&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>addInterviewObservation(store,decodeURIComponent(interviewObservation[1]),decodeURIComponent(interviewObservation[2]),d))});
    const interviewDecision=/^\/api\/problem-interviews\/([^/]+)\/([^/]+)\/decision$/.exec(pathname);
    if(interviewDecision&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>decideInterviewPlan(store,decodeURIComponent(interviewDecision[1]),decodeURIComponent(interviewDecision[2]),d))});
    const problemCheck=/^\/api\/problem-verification\/([^/]+)$/.exec(pathname);
    if(problemCheck&&req.method==='GET'){
      const id=decodeURIComponent(problemCheck[1]);
      return send(res,200,{...verificationContext(store,id),review:store.get('problem_verifications',id)||null});
    }
    if(problemCheck&&req.method==='POST'){
      const id=decodeURIComponent(problemCheck[1]);
      return send(res,200,{review:await ownerWrite(req,pathname,d=>verifyProblem(store,id,d))});
    }
    const feasibilityRoute=/^\/api\/opportunity-scan\/([^/]+)\/feasibility$/.exec(pathname);
    if(feasibilityRoute&&req.method==='GET')return send(res,200,opportunityFeasibilityBoard(store,decodeURIComponent(feasibilityRoute[1])));
    if(feasibilityRoute&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>saveOpportunityFeasibility(store,decodeURIComponent(feasibilityRoute[1]),d))});
    const competitionRoute=/^\/api\/opportunity-scan\/([^/]+)\/competition-space$/.exec(pathname);
    if(competitionRoute&&req.method==='GET')return send(res,200,opportunityCompetitionSpace(store,decodeURIComponent(competitionRoute[1])));
    const alternativeRoute=/^\/api\/opportunity-scan\/([^/]+)\/alternatives$/.exec(pathname);
    if(alternativeRoute&&req.method==='GET')return send(res,200,alternativeResearchBoard(store,decodeURIComponent(alternativeRoute[1])));
    if(alternativeRoute&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>recordAlternativeResearch(store,decodeURIComponent(alternativeRoute[1]),d))});
    const evidenceReviewRoute=/^\/api\/opportunity-scan\/([^/]+)\/evidence-review$/.exec(pathname);
    if(evidenceReviewRoute&&req.method==='GET')return send(res,200,evidenceReviewBoard(store,decodeURIComponent(evidenceReviewRoute[1])));
    if(evidenceReviewRoute&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,d=>reviewExternalEvidence(store,decodeURIComponent(evidenceReviewRoute[1]),d))});
    const workbenchRoute=/^\/api\/opportunity-scan\/([^/]+)\/workbench$/.exec(pathname);
    if(workbenchRoute&&req.method==='GET')return send(res,200,opportunityResearchWorkbench(store,decodeURIComponent(workbenchRoute[1])));
    const stageQuery=/^\/api\/opportunity-scan\/([^/]+)\/stage$/.exec(pathname);
    if(stageQuery&&req.method==='GET')return send(res,200,opportunityStage(store,decodeURIComponent(stageQuery[1])));
    const externalResearch=/^\/api\/opportunity-scan\/([^/]+)\/external-research$/.exec(pathname);
    if(externalResearch&&req.method==='GET')return send(res,200,externalResearchBrief(store,decodeURIComponent(externalResearch[1])));
    if(externalResearch&&req.method==='POST')return send(res,200,{result:await ownerWrite(req,pathname,()=>investigateExternalEvidence(store,decodeURIComponent(externalResearch[1])))});
    const deepResearch=/^\/api\/opportunity-scan\/([^/]+)\/research$/.exec(pathname);
    if(deepResearch&&req.method==='POST')return send(res,200,{draft:await draftOpportunityResearch(store,decodeURIComponent(deepResearch[1]))});
    const researchReview=/^\/api\/opportunity-scan\/([^/]+)\/review$/.exec(pathname);
    if(researchReview&&req.method==='POST')return send(res,200,{item:recordResearchReview(store,decodeURIComponent(researchReview[1]),await body(req))});
    if(pathname==='/api/opportunity-scoreboard'&&req.method==='GET')return send(res,200,opportunityScoreboard(store));
    if(pathname==='/api/opportunity-scoreboard/config'&&req.method==='POST')return send(res,200,{item:updateScorecardConfig(store,await body(req))});
    const homeDecision=/^\/api\/home\/opportunities\/([^/]+)\/decision$/.exec(pathname);
    if(homeDecision&&req.method==='POST'){
      const cid=decodeURIComponent(homeDecision[1]);
      return send(res,200,{item:await ownerWrite(req,pathname,data=>decideHomeOpportunity(store,cid,data))});
    }
    const homeConvert=/^\/api\/home\/opportunities\/([^/]+)\/convert$/.exec(pathname);
    if(homeConvert&&req.method==='POST'){
      const cid=decodeURIComponent(homeConvert[1]);
      const current=homeOpportunitySnapshot(store).items.find(x=>x.id===cid);
      if(!current)throw Object.assign(new Error('候选已忽略或失效'),{code:'CANDIDATE_CHANGED',status:409});
      const urls=current.sourceUrls.filter(x=>x.startsWith('https://'));
      if(!urls.length)throw Object.assign(new Error('候选缺少真实来源'),{code:'MISSING_EVIDENCE',status:409});
      const existing=store.list('opportunities').find(o=>o.sources?.some(x=>urls.includes(x.url)));
      if(existing)return send(res,200,{item:existing,alreadyExists:true});
      return send(res,201,{item:await ownerWrite(req,pathname,()=>service.createOpportunity({title:current.title,problem:current.summary||current.title,
        market:'International',risk:'AI 预筛未经人工验证；须调查现有竞品与独立需求',
        sources:urls.map(url=>({url,quote:current.summary||current.title,independent:false,origin:'ai_candidate'}))}))});
    }
    const homeFeedback=/^\/api\/home\/opportunities\/([^/]+)\/feedback$/.exec(pathname);
    if(homeFeedback&&req.method==='POST')return send(res,200,{item:await ownerWrite(req,pathname,data=>reviewHomeOpportunity(store,decodeURIComponent(homeFeedback[1]),data))});
    const identitySplit=/^\/api\/home\/knowledge\/([^/]+)\/split$/.exec(pathname);
    if(identitySplit&&req.method==='POST')return send(res,200,{result:await ownerWrite(req,pathname,d=>splitOpportunityIdentity(store,decodeURIComponent(identitySplit[1]),d))});
    if(pathname==='/api/home/knowledge'&&req.method==='GET')return send(res,200,opportunityIdentityIndex(store));
    const dossier=/^\/api\/home\/knowledge\/([^/]+)$/.exec(pathname);
    if(dossier&&req.method==='GET'){
      const item=opportunityIdentityDossier(store,decodeURIComponent(dossier[1]));
      if(!item)throw Object.assign(new Error('历史机会档案不存在'),{code:'NOT_FOUND',status:404});
      return send(res,200,item);
    }
    if(pathname==='/api/home/discovery'&&req.method==='GET')return send(res,200,homeDiscoveryDashboard(store));
    if(pathname==='/api/home/opportunities'&&req.method==='GET')return send(res,200,homeOpportunitySnapshot(store));
    if(pathname==='/api/home/opportunities/scan'&&req.method==='POST'){
      const scan=await scanSources(store,{});
      return send(res,200,{scan,discovery:await scanHomeOpportunities(store,{scanStats:{feeds:scan.feeds,received:scan.received,added:scan.added,filtered:scan.filtered,duplicates:scan.duplicates,errors:scan.errors.length}})});
    }
    if(pathname==='/api/opportunity-scan'&&req.method==='GET')return send(res,200,opportunityScanCandidates(store));
    if(pathname==='/api/opportunity-scan/run'&&req.method==='POST'){
      const result=await scanSources(store,{});
      return send(res,200,{scan:result,candidates:opportunityScanCandidates(store)});
    }
    if(pathname==='/api/signals/scan'&&req.method==='POST'){
      const data=await body(req);
      if(data.source_id!==undefined&&typeof data.source_id!=='string')throw Object.assign(new Error('source_id 必须是来源 ID 字符串'),{code:'BAD_REQUEST',status:400});
      return send(res,200,{result:await scanSources(store,{ids:data.source_id?[data.source_id]:undefined})});
    }
    const triage=/^\/api\/signals\/([^/]+)\/triage$/.exec(pathname);
    if(triage&&req.method==='POST')return send(res,200,{item:triageSignal(store,triage[1],await body(req))});
    if(pathname==='/api/signals/bulk-triage'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,d=>bulkTriageSignals(store,d)));
    if(pathname==='/api/mute-rules'&&req.method==='GET')return send(res,200,{items:muteRules(store)});
    if(pathname==='/api/mute-rules'&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>createMuteRule(store,d))});
    const muteDel=/^\/api\/mute-rules\/([^/]+)$/.exec(pathname);
    if(muteDel&&req.method==='DELETE')return send(res,200,{item:deleteMuteRule(store,muteDel[1])});
    if(pathname==='/api/mute-rules/apply'&&req.method==='POST')return send(res,200,await ownerWrite(req,pathname,()=>applyMuteRules(store)));
    const importing=/^\/api\/signals\/([^/]+)\/import$/.exec(pathname);
    if(importing&&req.method==='POST'){
      const signal=store.get('sources',importing[1]);if(!signal)return send(res,404,{error:'NOT_FOUND'});
      if(signal.status==='converted')return send(res,409,{error:'SIGNAL_CONVERTED',message:'该来源已关联过机会，不会重复导入'});
      const data=await body(req);
      const result=store.transaction(()=>{
        const item=service.createOpportunity({...data,title:data.title||signal.title,problem:data.problem||signal.description,market:data.market||signal.market||'待判断',sources:[{url:signal.url,quote:signal.description,independent:false,origin:'public_signal'}]});
        store.put('sources',{...signal,status:'converted',linkedOpportunityId:item.id,triagedAt:new Date().toISOString()},signal.revision);
        store.event('signal.converted',signal.id,'owner',{opportunityId:item.id});return item;
      });
      return send(res,201,{item:result});
    }
    const signal=/^\/api\/signals\/([^/]+)\/analyze$/.exec(pathname);
    if(signal&&req.method==='POST'){
      const item=store.get('sources',signal[1]);if(!item)return send(res,404,{error:'NOT_FOUND'});
      return send(res,200,{suggestion:await analyzeSignal(item,{locale:(await body(req)).locale}),source:item});
    }
    if(pathname==='/api/agent/setup'&&req.method==='GET'){
      const projectId=u.searchParams.get('project_id');
      const project=projectId?service.getFullProject(projectId):null;
      return send(res,200,agentSetupSummary(projectId,project,{enabled:Boolean(process.env.RADAR_AGENT_TOKEN),tools:service.tools}));
    }
    if(pathname==='/api/dashboard'&&req.method==='GET')return send(res,200,{...service.brief(),projects:store.list('projects')});
    const research=/^\/api\/opportunities\/([^/]+)\/research$/.exec(pathname);
    if(research&&req.method==='GET')return send(res,200,{report:researchReport(store,research[1])});
    const reviewEvidence=/^\/api\/opportunities\/([^/]+)\/evidence\/review$/.exec(pathname);
    if(reviewEvidence&&req.method==='POST')return send(res,200,{item:reviewOpportunityEvidence(store,reviewEvidence[1],await body(req))});
    if(pathname==='/api/validations/overview'&&req.method==='GET')return send(res,200,{items:validationOverview(store)});
    const validation=/^\/api\/opportunities\/([^/]+)\/validation$/.exec(pathname);
    if(validation&&req.method==='GET')return send(res,200,{result:validationSummary(store,validation[1])});
    if(validation&&req.method==='POST')return send(res,201,{item:createValidationPlan(store,validation[1],await body(req))});
    const observation=/^\/api\/opportunities\/([^/]+)\/validation\/([^/]+)\/observations$/.exec(pathname);
    if(observation&&req.method==='POST')return send(res,201,{item:recordValidationObservation(store,observation[1],observation[2],await body(req))});
    const validationClose=/^\/api\/opportunities\/([^/]+)\/validation\/([^/]+)\/close$/.exec(pathname);
    if(validationClose&&req.method==='POST')return send(res,200,{item:closeValidationPlan(store,validationClose[1],validationClose[2],await body(req))});
    if(pathname==='/api/opportunities'&&req.method==='GET')return send(res,200,{items:store.list('opportunities')});
    if(pathname==='/api/opportunities'&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>service.createOpportunity(d))});
    const oppStatus=/^\/api\/opportunities\/([^/]+)\/status$/.exec(pathname);
    if(oppStatus&&req.method==='POST')return send(res,200,{item:service.changeOpportunityStatus(oppStatus[1],await body(req))});
    const linkSignal=/^\/api\/signals\/([^/]+)\/link$/.exec(pathname);
    if(linkSignal&&req.method==='POST'){
      const data=await body(req);return send(res,200,{item:service.attachSignalToOpportunity(linkSignal[1],data.opportunity_id)});
    }
    if(pathname==='/api/experiments'&&req.method==='POST')return send(res,201,{project:await ownerWrite(req,pathname,d=>service.startExperiment(d))});
    if(pathname==='/api/history'&&req.method==='GET')return send(res,200,{projects:store.list('projects'),ledger:store.list('ledger')});
    const kickoff=/^\/api\/projects\/([^/]+)\/kickoff$/.exec(pathname);
    if(kickoff&&req.method==='POST')return send(res,200,service.prepareKickoff(kickoff[1]));
    const projectFeedback=/^\/api\/projects\/([^/]+)\/feedback$/.exec(pathname);
    if(projectFeedback&&req.method==='GET')return send(res,200,{result:feedbackOverview(store,projectFeedback[1])});
    if(projectFeedback&&req.method==='POST')return send(res,201,{item:recordProductFeedback(store,projectFeedback[1],await body(req))});
    const taskHistory=/^\/api\/projects\/([^/]+)\/owner-tasks\/([^/]+)\/history$/.exec(pathname);
    if(taskHistory&&req.method==='GET')return send(res,200,{items:ownerTaskHistory(store,taskHistory[1],taskHistory[2],{limit:u.searchParams.get('limit')??30})});
    const taskTimeline=/^\/api\/projects\/([^/]+)\/owner-tasks\/([^/]+)\/timeline$/.exec(pathname);
    if(taskTimeline&&req.method==='GET')return send(res,200,ownerTaskTimeline(store,taskTimeline[1],taskTimeline[2]));
    const taskArchive=/^\/api\/projects\/([^/]+)\/owner-tasks\/([^/]+)\/(archive|unarchive)$/.exec(pathname);
    if(taskArchive&&req.method==='POST')return send(res,200,{item:(taskArchive[3]==='archive'?archiveOwnerTask:unarchiveOwnerTask)(store,taskArchive[1],taskArchive[2],await body(req))});
    const taskBoard=/^\/api\/projects\/([^/]+)\/owner-tasks\/board$/.exec(pathname);
    if(taskBoard&&req.method==='GET')return send(res,200,ownerTaskBoard(store,taskBoard[1]));
    const planning=/^\/api\/projects\/([^/]+)\/owner-tasks$/.exec(pathname);
    if(planning&&req.method==='GET')return send(res,200,{items:projectOwnerTasks(store,planning[1])});
    if(planning&&req.method==='POST')return send(res,200,{item:upsertOwnerTask(store,planning[1],await body(req))});
    const proj=/^\/api\/projects\/([^/]+)$/.exec(pathname);
    if(proj&&req.method==='GET'){const result=service.getFullProject(proj[1]);return send(res,200,{...result,ledgerSummary:service.summaryLedger(result.ledger),decisionReview:experimentDecisionReview(result),pipeline:projectPipeline({...result,ownerTasks:projectOwnerTasks(store,proj[1]),reviewSummary:reviewSummary(store,proj[1])}),ownerTasks:projectOwnerTasks(store,proj[1]),reviewSummary:reviewSummary(store,proj[1]),campaignReview:campaignOverview(store,result),events:store.eventsLatest(50,proj[1])});}
    const reviewDecide=/^\/api\/projects\/([^/]+)\/reviews\/([^/]+)\/decide$/.exec(pathname);
    if(reviewDecide&&req.method==='POST')return send(res,200,{item:decideOpportunityReview(store,reviewDecide[1],reviewDecide[2],await body(req))});
    const reviewDraft=/^\/api\/projects\/([^/]+)\/reviews\/draft$/.exec(pathname);
    if(reviewDraft&&req.method==='GET')return send(res,200,buildReviewDraft(store,reviewDraft[1],{windowFrom:u.searchParams.get('from')||undefined,windowTo:u.searchParams.get('to')||undefined}));
    const reviews=/^\/api\/projects\/([^/]+)\/reviews$/.exec(pathname);
    if(reviews&&req.method==='GET')return send(res,200,{items:opportunityReviews(store,reviews[1])});
    if(reviews&&req.method==='POST')return send(res,201,{item:createOpportunityReview(store,reviews[1],await body(req))});
    const decision=/^\/api\/projects\/([^/]+)\/decide$/.exec(pathname);
    if(decision&&req.method==='POST')return send(res,200,{result:service.ownerDecision(decision[1],await body(req))});
    const generate=/^\/api\/projects\/([^/]+)\/contents\/generate$/.exec(pathname);
    if(generate&&req.method==='POST')return send(res,200,{draft:await draftLaunchContent(service.getFullProject(generate[1]),await body(req))});
    const content=/^\/api\/projects\/([^/]+)\/contents$/.exec(pathname);
    if(content&&req.method==='POST')return send(res,200,{item:service.saveContent(content[1],await body(req))});
    const schedule=/^\/api\/projects\/([^/]+)\/contents\/([^/]+)\/schedule$/.exec(pathname);
    if(schedule&&req.method==='POST')return send(res,200,{item:service.scheduleContent(schedule[1],schedule[2],await body(req))});
    const review=/^\/api\/projects\/([^/]+)\/contents\/([^/]+)\/review$/.exec(pathname);
    if(review&&req.method==='POST')return send(res,200,{item:service.reviewContent(review[1],review[2],await body(req))});
    // v2.9 Phase B: promotion campaigns (owner-only, manual publication only).
    const campaignsList=/^\/api\/projects\/([^/]+)\/campaigns$/.exec(pathname);
    if(campaignsList&&req.method==='GET')return send(res,200,campaignOverview(store,service.getFullProject(campaignsList[1])));
    if(campaignsList&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>createCampaign(store,campaignsList[1],d))});
    const campaignAction=/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)\/(adjust|cancel|complete|retrospective)$/.exec(pathname);
    if(campaignAction&&req.method==='POST'){
      const data=await body(req);
      const fn={adjust:adjustCampaign,cancel:cancelCampaign,complete:completeCampaign,retrospective:recordRetrospective}[campaignAction[3]];
      return send(res,200,{item:fn(store,campaignAction[1],campaignAction[2],data)});
    }
    const ledger=/^\/api\/projects\/([^/]+)\/ledger$/.exec(pathname);
    if(ledger&&req.method==='POST')return send(res,201,{item:await ownerWrite(req,pathname,d=>service.addLedger(ledger[1],d))});
    const ledgerEntry=/^\/api\/projects\/([^/]+)\/ledger\/([^/]+)\/(retract|revise)$/.exec(pathname);
    if(ledgerEntry&&req.method==='POST'){const act=ledgerEntry[3];return send(res,200,{item:await ownerWrite(req,pathname,d=>act==='retract'?service.retractLedger(ledgerEntry[1],ledgerEntry[2],d):service.reviseLedger(ledgerEntry[1],ledgerEntry[2],d))});}
    const growth=/^\/api\/projects\/([^/]+)\/growth$/.exec(pathname);
    if(growth&&req.method==='GET')return send(res,200,growthOverview(store,growth[1]));
    const growthReportRoute=/^\/api\/projects\/([^/]+)\/growth\/report$/.exec(pathname);
    if(growthReportRoute&&req.method==='GET')return send(res,200,growthReport(store,growthReportRoute[1],{from:u.searchParams.get('from')||undefined,to:u.searchParams.get('to')||undefined,granularity:u.searchParams.get('granularity')||'day'}));
    const growthHistoryRoute=/^\/api\/projects\/([^/]+)\/growth\/history$/.exec(pathname);
    if(growthHistoryRoute&&req.method==='GET')return send(res,200,{items:growthHistory(store,growthHistoryRoute[1],{metricId:u.searchParams.get('metric_id')||'',limit:Number(u.searchParams.get('limit')||50)})});
    const growthChannel=/^\/api\/projects\/([^/]+)\/growth\/channels$/.exec(pathname);
    if(growthChannel&&req.method==='POST')return send(res,201,{item:createGrowthChannel(store,growthChannel[1],await body(req))});
    const growthCampaign=/^\/api\/projects\/([^/]+)\/growth\/campaigns$/.exec(pathname);
    if(growthCampaign&&req.method==='POST')return send(res,201,{item:createGrowthCampaign(store,growthCampaign[1],await body(req))});
    const growthMetricImport=/^\/api\/projects\/([^/]+)\/growth\/metrics\/import$/.exec(pathname);
    if(growthMetricImport&&req.method==='POST')return send(res,200,importGrowthMetrics(store,growthMetricImport[1],await body(req)));
    const growthMetric=/^\/api\/projects\/([^/]+)\/growth\/metrics$/.exec(pathname);
    if(growthMetric&&req.method==='POST')return send(res,201,{item:recordGrowthMetric(store,growthMetric[1],await body(req))});
    const growthMetricAction=/^\/api\/projects\/([^/]+)\/growth\/metrics\/([^/]+)\/(revise|retract|verify)$/.exec(pathname);
    if(growthMetricAction&&req.method==='POST'){
      const [,projectId,metricId,action]=growthMetricAction;const data=await body(req);
      const item=action==='revise'?reviseGrowthMetric(store,projectId,metricId,data):action==='retract'?retractGrowthMetric(store,projectId,metricId,data):verifyGrowthMetric(store,projectId,metricId,data);
      return send(res,200,{item});
    }
    const attest=/^\/api\/projects\/([^/]+)\/evidence\/([^/]+)\/attest$/.exec(pathname);
    if(attest&&req.method==='POST'){
      const e=store.get('evidence',attest[2]);if(!e||e.projectId!==attest[1])return send(res,404,{error:'NOT_FOUND'});
      const data=await body(req);if(typeof data.reason!=='string'||data.reason.trim().length<8)return send(res,400,{error:'REASON_REQUIRED',message:'人工核查需要填写具体的可复查理由（至少8个字）'});
      if(!e.sourceUri)return send(res,409,{error:'SOURCE_REQUIRED',message:'无来源的内容不能通过人工核查'});
      if(/^https:\/\/github\.com\//i.test(e.sourceUri)||/^github_/i.test(e.type))return send(res,409,{error:'GITHUB_AUTOMATED_CHECK_REQUIRED',message:'GitHub 交付证据必须通过 GitHub API 检查，不允许人工确认绕过 CI'});
      const item=store.put('evidence',{...e,verificationState:'owner_attested',verificationReason:data.reason,verifiedAt:new Date().toISOString()},e.revision);
      store.event('evidence.owner_attested',e.id,'owner',{reason:data.reason},e.projectId);return send(res,200,{item});}
    const verify=/^\/api\/projects\/([^/]+)\/evidence\/([^/]+)\/verify$/.exec(pathname);
    if(verify&&req.method==='POST'){
      const e=store.get('evidence',verify[2]);if(!e||e.projectId!==verify[1])return send(res,404,{error:'NOT_FOUND'});
      const state=await verifyGitHubEvidence(e);
      const saved=store.put('evidence',{...e,verificationState:state.state,verificationReason:state.reason,checks:state.checks||[],verifiedAt:new Date().toISOString()},e.revision);
      store.event('evidence.verified',e.id,'system',state,e.projectId);return send(res,200,{item:saved});}
    return send(res,404,{error:'NOT_FOUND',message:'Unknown endpoint'});
  }catch(e){console.error(`[${new Date().toISOString()}] ${e.code||'ERROR'}: ${e.message}`);send(res,e.status||500,{error:e.code||'INTERNAL_ERROR',message:e.status?e.message:'服务出现错误，请检查终端日志'});}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createServer();
  server.listen(port,host,()=>console.log(`Opportunity Radar running at http://${host}:${port}\nAgent API ${process.env.RADAR_AGENT_TOKEN?'enabled':'disabled'}`));
  const scheduler=createSourceScheduler(store);scheduler.start();
  const productionGuard=createProductionGuard(store);productionGuard.start();
  process.once('SIGINT',()=>{scheduler.stop();productionGuard.stop();server.close();});
  process.once('SIGTERM',()=>{scheduler.stop();server.close();});
}
