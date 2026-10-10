import { randomUUID, createHash } from 'node:crypto';

const now=()=>new Date().toISOString();
const err=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const required=(s,name)=>{if(typeof s!=='string'||!s.trim())throw err('BAD_REQUEST',`${name} is required`);return s.trim();};
const parseHttps=(x)=> {if(!x)return null;try{const u=new URL(x);if(u.protocol!=='https:')throw Error();u.hash='';for(const p of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(p))u.searchParams.delete(p);return u.href;}catch{throw err('BAD_REQUEST','Evidence URL must be HTTPS');}};
const ensureRevision=(v)=>{if(!Number.isInteger(v)||v<1) throw err('BAD_REQUEST','expected_revision is required');return v;};
const nonNegative=(v,name)=>{const n=Number(v);if(!Number.isFinite(n)||n<0)throw err('BAD_REQUEST',`${name} must be >= 0`);return n;};

export function createService(store, options={}){
  const get=(kind,id)=>{const value=store.get(kind,id); if(!value)throw err('NOT_FOUND',`${kind} ${id} not found`,404);return value;};
  const event=(type,entity,actor,detail,project)=>store.event(type,entity,actor,detail,project);
  const owner='owner'; const agent='agent:external';
  const withIdem=(name,key,args,fn)=>store.idempotent(agent,key,fn,createHash('sha256').update(JSON.stringify({name,args})).digest('hex'));
  const getProject=(id)=>get('projects',id);
  const assertActive=(id)=>{const p=getProject(id);if(['paused','stopped','archived'].includes(p.status))throw err('PROJECT_NOT_ACTIVE','项目已暂停或结束',409);return p;};
  const baseline=(id)=>getProject(id).baselines.at(-1);
  const leaseCheck=(task,token)=>{ if(!task.lease||task.lease.token!==token||task.lease.holder!==agent || Date.parse(task.lease.expiresAt)<Date.now()) throw err('LEASE_INVALID','任务租约无效或已过期',409);};
  const cloneJson=(x)=>JSON.parse(JSON.stringify(x));

  function createOpportunity(data){
    const problem=required(data.problem,'problem');const market=required(data.market,'market'); const title=required(data.title,'title');
    const sources=(data.sources||[]).map(s=>({url:parseHttps(s.url),quote:String(s.quote||'').slice(0,700),independent:s.independent===true,origin:s.origin||'user'}));
    const distinct=[...new Map(sources.filter(s=>s.url).map(s=>[s.url,s])).values()];
    const item=store.put('opportunities',{id:randomUUID(),title,problem,market,language:data.language||'zh-CN',audience:data.audience||'',channel:data.channel||'',advantage:data.advantage||'',risk:data.risk||'尚未识别足够的反对性证据',nextAction:data.nextAction||'进一步获取独立消费者证据',sources:distinct,evidenceStatus:distinct.length?'needs_verification':'unknown',status:'candidate',createdAt:now(),demo:false});
    event('opportunity.created',item.id,owner,{title:item.title}); return item;
  }
  function brief(){const cutoff=Date.now()-7*86400000;const active=store.list('projects').find(x=>!['paused','stopped','archived'].includes(x.status));
    const candidates=store.list('opportunities').filter(x=>x.status==='candidate').slice(0,3);return {candidates,active,allCount:store.list('opportunities').length,weekStart:new Date(cutoff).toISOString(),note:candidates.length?'来源仅为待核验线索，不代表已证明市场需求':'目前没有足够的机会线索，可以不推荐。'};}
  function startExperiment(data){return store.transaction(()=>{
    const o=get('opportunities',data.opportunityId);
    if(store.list('projects').some(x=>!['paused','stopped','archived'].includes(x.status)))throw err('ACTIVE_EXPERIMENT_EXISTS','同时只能有一个主实验',409);
    const hours=nonNegative(data.hours??10,'hours'); if(hours>10)throw err('EXTRA_BUDGET_REQUIRES_APPROVAL','初始基线每周最多10小时，额外时间需新证据和单独审批',409);
    const cash=nonNegative(data.cash??0,'cash');
    const criteria=(data.criteria||[]).map(x=>required(x,'criterion'));if(!criteria.length)throw err('BAD_REQUEST','需要至少一条可验证验收标准');
    const goal=required(data.goal,'goal'), hypothesis=required(data.hypothesis,'hypothesis'), stopCondition=required(data.stopCondition,'stopCondition');
    const pId=randomUUID();
    const b={revision:1,approvedAt:now(),approvedBy:owner,goal,hypothesis,scope:data.scope||'',nonGoals:data.nonGoals||'',stopCondition,criteria:criteria.map(text=>({id:randomUUID(),text})),budget:{weeklyUserHours:hours,cash},evidenceIds:[]};
    const p=store.put('projects',{id:pId,opportunityId:o.id,name:o.title,market:data.market||o.market,channel:data.channel||o.channel,status:'research',stage:'research',baselines:[b],milestoneIds:[],latestAgentReport:null,agentLastSync:null,createdAt:now(),lastDecision:'实验已批准',externalProcessState:'unknown'});
    const items=[{title:'消费者需求取证',description:'获得可追溯的独立需求线索',acceptanceIds:[]},{title:'最小产品交付',description:'按批准的验收要求提供可运行原型',acceptanceIds:b.criteria.map(x=>x.id)},{title:'宣发与真实反馈',description:'人工发布并记录真实用户行为',acceptanceIds:[]}];
    for(let i=0;i<items.length;i++){const m=store.put('milestones',{id:randomUUID(),projectId:pId,order:i+1,...items[i],executionState:'not_started',evidenceState:'not_verified',acceptanceState:'pending',createdAt:now()});p.milestoneIds.push(m.id);}
    const saved=store.put('projects',p,p.revision);
    store.put('opportunities',{...o,status:'experiment'},o.revision);event('experiment.approved',pId,owner,{baselineRevision:1},pId);return saved;
  });}
  function getFullProject(id){const p=getProject(id);return {...p,opportunity:store.get('opportunities',p.opportunityId),milestones:store.list('milestones').filter(m=>m.projectId===id).sort((a,b)=>a.order-b.order),tasks:store.list('tasks').filter(t=>t.projectId===id),evidence:store.list('evidence').filter(x=>x.projectId===id),submissions:store.list('submissions').filter(x=>x.projectId===id),decisions:store.list('decisions').filter(x=>x.projectId===id),contents:store.list('contents').filter(x=>x.projectId===id),ledger:store.list('ledger').filter(x=>x.projectId===id)};}
  function ownerDecision(id,data){const p=getProject(id);const action=required(data.action,'action');
    if(action==='pause'||action==='stop'||action==='resume'){
      if(action==='resume' && p.status!=='paused')throw err('BAD_STATE','只有暂停项目才能恢复',409);
      if(action==='resume'&&store.list('projects').some(x=>x.id!==id&&!['paused','stopped','archived'].includes(x.status)))throw err('ACTIVE_EXPERIMENT_EXISTS','已有其他主实验',409);
      const status=action==='pause'?'paused':action==='stop'?'stopped':'research';
      const updated=store.put('projects',{...p,status,externalProcessState:'unknown',lastDecision:action==='pause'?'已暂停':action==='stop'?'已停止授权（外部执行未确认停止）':'已批准恢复，待外部状态检查'},p.revision);
      event(`project.${action}`,id,owner,{reason:data.reason||'',externalExecutionConfirmed:false},id);return updated;
    }
    if(action==='revise_baseline'){
      const b=baseline(id);
      const reason=required(data.reason,'reason');
      const criteria=(data.criteria||b.criteria.map(x=>x.text)).map(x=>required(x,'criterion'));
      if(!criteria.length)throw err('BAD_REQUEST','至少需要一项验收标准');
      const next={...cloneJson(b),revision:b.revision+1,approvedAt:now(),approvedBy:owner,goal:required(data.goal??b.goal,'goal'),scope:data.scope??b.scope,nonGoals:data.nonGoals??b.nonGoals,criteria:criteria.map(text=>({id:b.criteria.find(c=>c.text===text)?.id||randomUUID(),text})),stopCondition:required(data.stopCondition??b.stopCondition,'stopCondition'),changeReason:reason};
      const updated=store.put('projects',{...p,baselines:[...p.baselines,next],lastDecision:'用户已批准新的基线版本'},p.revision);
      for(const m of store.list('milestones').filter(m=>m.projectId===id&&m.order===2)){store.put('milestones',{...m,acceptanceIds:next.criteria.map(c=>c.id),evidenceState:'not_verified',acceptanceState:'pending'},m.revision);}
      event('baseline.approved',id,owner,{revision:next.revision,reason},id);
      return updated;
    }
    if(action==='approve_budget'){
      const hours=nonNegative(data.hours,'hours');if(hours>20)throw err('BAD_REQUEST','每周个人主动时间上限20小时');
      required(data.newEvidence,'newEvidence');const b=baseline(id);const next={...cloneJson(b),revision:b.revision+1,approvedAt:now(),approvedBy:owner,evidenceIds:[data.newEvidence],budget:{...b.budget,weeklyUserHours:hours}};
      const p2=store.put('projects',{...p,baselines:[...p.baselines,next],lastDecision:'已批准基线预算修订'},p.revision);event('baseline.approved',id,owner,{revision:next.revision,reason:data.newEvidence},id);return p2;
    }
    if(action==='accept'||action==='reject'){
      const sub=get('submissions',required(data.submissionId,'submissionId'));if(sub.projectId!==id)throw err('NOT_FOUND','提交不属于该项目',404);
      if(sub.baselineRevision!==baseline(id).revision)throw err('BASELINE_STALE','交付基线过期',409);
      if(sub.acceptanceState!=='pending')throw err('BAD_STATE','本次交付已经处理',409);
      const newest=store.list('submissions').filter(x=>x.projectId===id&&x.milestoneId===sub.milestoneId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
      if(newest?.id!==sub.id)throw err('SUBMISSION_SUPERSEDED','只能验收当前里程碑的最新交付',409);
      const reason=required(data.reason,'reason'); const e=store.list('evidence').filter(x=>sub.evidenceIds.includes(x.id));
      if(action==='accept' && (!e.length || e.some(x=>!['verified','owner_attested'].includes(x.verificationState)) || sub.g2State!=='covered'))throw err('EVIDENCE_NOT_VERIFIED','证据尚未全部核验且验收条件未覆盖，不能批准',409);
      const m=get('milestones',sub.milestoneId);
      if(action==='accept' && m.order===2 && (!sub.commitSha || !e.some(item=>
        item.verificationState==='verified' &&
        item.commitSha?.toLowerCase()===sub.commitSha.toLowerCase() &&
        /^https:\/\/github\.com\//i.test(item.sourceUri||'') &&
        Array.isArray(item.checks) && item.checks.length>0))){
        throw err('GITHUB_G1_REQUIRED','产品代码交付必须有与提交 SHA 一致、已核实必需 CI 的 GitHub 证据',409);
      }
      const nextSub=store.put('submissions',{...sub,acceptanceState:action==='accept'?'accepted':'rejected',decisionReason:reason,decidedAt:now(),decidedBy:owner},sub.revision);
      store.put('milestones',{...m,acceptanceState:action==='accept'?'accepted':'rejected',executionState:action==='accept'?'submitted':'rework',evidenceState:action==='accept'?'verified':m.evidenceState},m.revision);
      store.put('projects',{...p,status:action==='accept'?(m.order===1?'execution':m.order===2?'promotion':'review'):'execution',stage:action==='accept'?(m.order===1?'execution':m.order===2?'promotion':'review'):'execution'},p.revision);
      event('acceptance.decided',sub.id,owner,{decision:action,reason,sha:sub.commitSha},id);return nextSub;
    }
    if(action==='resolve_request'){
      const req=get('decisions',required(data.requestId,'requestId'));if(req.projectId!==id||req.status!=='pending')throw err('BAD_STATE','申请不存在或已处理',409);
      if(!['approved','rejected'].includes(data.resolution))throw err('BAD_REQUEST','resolution should be approved or rejected');
      const next=store.put('decisions',{...req,status:data.resolution,resolutionNote:required(data.reason,'reason'),resolvedAt:now()},req.revision);
      event('decision.resolved',req.id,owner,{resolution:data.resolution},id);return next;
    }
    throw err('BAD_REQUEST','unknown decision action');
  }
  function saveContent(id,data){assertActive(id);if(data.id){const old=get('contents',data.id);if(old.projectId!==id)throw err('FORBIDDEN','outside project',403);const updated=store.put('contents',{...old,versions:[...(old.versions||[]),{revision:old.revision,title:old.title,body:old.body,reviewState:old.reviewState,publication:old.publication||null,archivedAt:now()}],title:required(data.title,'title'),body:required(data.body,'body'),objective:required(data.objective,'objective'),channel:required(data.channel,'channel'),claims:data.claims||[],reviewState:'draft',approvedRevision:null,publication:null},ensureRevision(data.expected_revision));event('content.updated',updated.id,owner,{revision:updated.revision},id);return updated;}
    const c=store.put('contents',{id:randomUUID(),projectId:id,title:required(data.title,'title'),body:required(data.body,'body'),objective:required(data.objective,'objective'),channel:required(data.channel,'channel'),materialRefs:data.materialRefs||[],claims:data.claims||[],reviewState:'draft',approvedRevision:null,publication:null,createdAt:now()});event('content.created',c.id,owner,{},id);return c;}
  function reviewContent(id,contentId,data){const c=get('contents',contentId);if(c.projectId!==id)throw err('NOT_FOUND','content outside project',404);const action=required(data.action,'action');
    if(action==='approve'){
      if(data.privacyChecked!==true||data.factsChecked!==true)throw err('REVIEW_REQUIRED','需要人工确认真实性和隐私审查',409);
      if(c.claims.some(x=>!x.sourceRef||!x.productRevision))throw err('UNSUPPORTED_CLAIM','功能主张缺少产品版本及证据',409);
      const next=store.put('contents',{...c,reviewState:'approved',approvedRevision:c.revision+1,reviewedAt:now()},c.revision);
      event('content.approved',c.id,owner,{revision:next.revision},id);return next;
    }
    if(action==='publish_record'){
      if(c.reviewState!=='approved'||c.approvedRevision!==c.revision)throw err('CONTENT_NOT_APPROVED','未批准内容不能登记为已发布',409);
      const u=parseHttps(required(data.url,'url'));
      const next=store.put('contents',{...c,reviewState:'published',publication:{url:u,at:now(),platform:data.platform||c.channel,recordedBy:'owner'},approvedRevision:c.revision+1},c.revision);
      event('content.published_recorded',c.id,owner,{url:u,manual:true},id);return next;
    }
    throw err('BAD_REQUEST','unknown content action');}
  function addLedger(id,data){getProject(id);const allowed=['impressions','visits','interest','trials','activation','reuse','income','refund','transaction_fee','service_cost','cash_cost','user_hours','agent_hours','brand','learning'];if(!allowed.includes(data.type))throw err('BAD_REQUEST','invalid ledger metric');
    const entry=store.put('ledger',{id:randomUUID(),projectId:id,type:data.type,value:nonNegative(data.value,'value'),unit:data.unit||(['user_hours','agent_hours'].includes(data.type)?'h':['income','refund','transaction_fee','service_cost','cash_cost'].includes(data.type)?'CNY':'count'),source:data.source||'manual_unverified',actual:data.actual===true,notes:data.notes||'',at:now(),createdAt:now()});event('ledger.recorded',entry.id,owner,{type:entry.type,value:entry.value,actual:entry.actual},id);return entry;}
  function summaryLedger(entries){const sum=t=>entries.filter(x=>x.type===t&&x.actual).reduce((a,x)=>a+x.value,0);return {collected:sum('income'),refunds:sum('refund'),contribution:sum('income')-sum('refund')-sum('transaction_fee')-sum('service_cost'),userHours:sum('user_hours'),agentHours:sum('agent_hours'),cashSpent:sum('cash_cost')};}

  function tool(name,p={}){
    if(name==='project.get_context'){const x=getFullProject(p.project_id);return {project:{id:x.id,name:x.name,status:x.status,stage:x.stage,agentLastSync:x.agentLastSync,milestones:x.milestones,tasks:x.tasks,evidence:x.evidence,submissions:x.submissions,decisions:x.decisions.filter(d=>['pending','approved','rejected'].includes(d.status)).map(d=>({id:d.id,kind:d.kind,summary:d.summary,status:d.status}))},baseline:baseline(p.project_id),serverTime:now()};}
    if(name==='project.get_next_work'){assertActive(p.project_id);return {tasks:store.list('tasks').filter(x=>x.projectId===p.project_id&&['open','rework'].includes(x.status)).filter(x=>x.dependencies.every(id=>store.get('tasks',id)?.status==='submitted')).slice(0,20)};}
    if(name==='project.watch_changes'){
      getProject(p.project_id);const original=store.events(Number(p.cursor)||0,p.project_id);
      const allowed=['experiment.','baseline.','project.','task.','agent.','evidence.','submission.','acceptance.','decision.'];
      const events=original.filter(x=>allowed.some(prefix=>x.kind.startsWith(prefix)));
      return {events,next_cursor:original.length?original.at(-1).seq:Number(p.cursor)||0,serverTime:now()};}
    if(name==='task.claim')return withIdem(name,p.idempotency_key,p,()=>{assertActive(p.project_id);const t=get('tasks',required(p.task_id,'task_id'));
      if(t.projectId!==p.project_id)throw err('FORBIDDEN','wrong project',403);
      if(t.lease&&Date.parse(t.lease.expiresAt)>Date.now()){
        if(p.lease_token!==t.lease.token)throw err('TASK_CLAIMED','任务已经被领取',409);
        const lease={...t.lease,expiresAt:new Date(Date.now()+15*60000).toISOString()};
        const renewed=store.put('tasks',{...t,lease},p.expected_revision??t.revision);
        event('task.lease_renewed',t.id,agent,{generation:lease.generation},t.projectId);
        return {task:renewed,lease_token:lease.token,renewed:true};
      }
      if(t.lease&&Date.parse(t.lease.expiresAt)<=Date.now()&&(!p.recovery_checked||typeof p.recovery_note!=='string'||p.recovery_note.trim().length<8))throw err('RECONCILIATION_REQUIRED','旧租约已过期；必须先核对实际外部工作，再重新领取',409);
      if(!['open','rework','in_progress'].includes(t.status))throw err('BAD_STATE','task not claimable',409);
      const token=randomUUID();const lease={token,holder:agent,generation:(t.lease?.generation||0)+1,expiresAt:new Date(Date.now()+15*60000).toISOString()};
      const next=store.put('tasks',{...t,lease,status:'in_progress'},p.expected_revision??t.revision);event('task.claimed',t.id,agent,{generation:lease.generation,reconciliationNote:t.lease?p.recovery_note:null},t.projectId);return {task:next,lease_token:token};});
    if(name==='task.upsert')return withIdem(name,p.idempotency_key,p,()=>{
      assertActive(p.project_id);if(p.task_id){const t=get('tasks',p.task_id);if(t.projectId!==p.project_id)throw err('FORBIDDEN','wrong project',403);leaseCheck(t,p.lease_token);
        const next=store.put('tasks',{...t,title:required(p.title??t.title,'title'),description:p.description??t.description,dependencies:p.dependencies??t.dependencies},ensureRevision(p.expected_revision));event('task.updated',t.id,agent,{},t.projectId);return next;}
      const m=get('milestones',required(p.milestone_id,'milestone_id'));if(m.projectId!==p.project_id)throw err('FORBIDDEN','milestone outside project',403);
      for(const dep of p.dependencies||[]){const dt=get('tasks',dep);if(dt.projectId!==p.project_id)throw err('FORBIDDEN','dependency outside project',403);}
      const t=store.put('tasks',{id:randomUUID(),projectId:p.project_id,milestoneId:m.id,title:required(p.title,'title'),description:p.description||'',status:'open',dependencies:p.dependencies||[],lease:null,createdAt:now()});event('task.created',t.id,agent,{milestoneId:m.id},p.project_id);return t;});
    if(name==='task.transition')return withIdem(name,p.idempotency_key,p,()=>{const t=get('tasks',required(p.task_id,'task_id'));assertActive(t.projectId);leaseCheck(t,p.lease_token);if(!['in_progress','blocked','submitted','rework'].includes(p.status))throw err('BAD_REQUEST','invalid task status');
      const x=store.put('tasks',{...t,status:p.status},ensureRevision(p.expected_revision));event('task.transitioned',t.id,agent,{status:p.status},t.projectId);return x;});
    if(name==='task.release')return withIdem(name,p.idempotency_key,p,()=>{const t=get('tasks',required(p.task_id,'task_id'));leaseCheck(t,p.lease_token);const next=store.put('tasks',{...t,lease:null,status:t.status==='in_progress'?'open':t.status},ensureRevision(p.expected_revision));event('task.released',t.id,agent,{externalProcessStopped:false},t.projectId);return next;});
    if(name==='progress.report')return withIdem(name,p.idempotency_key,p,()=>{const pr=assertActive(p.project_id);const updated=store.put('projects',{...pr,latestAgentReport:required(p.summary,'summary'),agentLastSync:now()},pr.revision);event('agent.reported',pr.id,agent,{summary:p.summary,limitations:p.limitations||[]},pr.id);return {lastSync:updated.agentLastSync,projectRevision:updated.revision};});
    if(name==='evidence.attach')return withIdem(name,p.idempotency_key,p,()=>{assertActive(p.project_id);const m=get('milestones',required(p.milestone_id,'milestone_id'));if(m.projectId!==p.project_id)throw err('FORBIDDEN','milestone outside project',403);
      const criteriaIds=p.criteria_ids||[];if(!Array.isArray(criteriaIds)||criteriaIds.some(id=>!m.acceptanceIds.includes(id)))throw err('BAD_REQUEST','验收条件必须属于该里程碑');
      const e=store.put('evidence',{id:randomUUID(),projectId:p.project_id,milestoneId:m.id,type:required(p.type,'type'),sourceUri:parseHttps(p.source_uri),repo:p.repo||null,commitSha:p.commit_sha||null,criteriaIds,verificationState:'pending',reason:'尚未由可信 GitHub 来源核验',createdAt:now()});event('evidence.attached',e.id,agent,{state:'pending'},p.project_id);return e;});
    if(name==='issue.raise_blocker')return withIdem(name,p.idempotency_key,p,()=>{assertActive(p.project_id);const id=randomUUID();event('agent.blocker',id,agent,{summary:required(p.summary,'summary'),options:p.options||[]},p.project_id);return {id,state:'recorded'};});
    if(name==='decision.request')return withIdem(name,p.idempotency_key,p,()=>{assertActive(p.project_id);const d=store.put('decisions',{id:randomUUID(),projectId:p.project_id,kind:required(p.kind,'kind'),summary:required(p.summary,'summary'),impact:p.impact||'',alternatives:p.alternatives||[],status:'pending',createdAt:now()});event('decision.requested',d.id,agent,{summary:d.summary},p.project_id);return d;});
    if(name==='handoff.submit')return withIdem(name,p.idempotency_key,p,()=>{assertActive(p.project_id);const m=get('milestones',required(p.milestone_id,'milestone_id'));if(m.projectId!==p.project_id)throw err('FORBIDDEN','milestone outside project',403);
      const b=baseline(p.project_id);if(p.baseline_revision!==b.revision)throw err('BASELINE_STALE','交付使用的基线版本已过期',409);
      const ids=p.evidence_ids||[];if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw err('BAD_REQUEST','evidence_ids 必须唯一');for(const id of ids){const e=get('evidence',id);if(e.projectId!==p.project_id||e.milestoneId!==m.id)throw err('FORBIDDEN','evidence outside milestone',403);if(p.commit_sha&&e.commitSha&&e.commitSha!==p.commit_sha)throw err('SHA_MISMATCH','证据版本与提交版本不符',409);}
      const covered=m.acceptanceIds.every(criterionId=>ids.some(id=>get('evidence',id).criteriaIds.includes(criterionId)))&&ids.length>0;
      const sub=store.put('submissions',{id:randomUUID(),projectId:p.project_id,milestoneId:m.id,baselineRevision:b.revision,commitSha:p.commit_sha||null,evidenceIds:ids,previewLink:p.preview_link?parseHttps(p.preview_link):null,g2State:covered?'covered':'missing',acceptanceState:'pending',knownGaps:p.known_gaps||[],createdAt:now()});
      store.put('milestones',{...m,executionState:'submitted',evidenceState:'pending',acceptanceState:'pending'},m.revision);event('submission.created',sub.id,agent,{commitSha:sub.commitSha,covered},p.project_id);return sub;});
    if(name==='collaboration.handoff')throw err('CAPABILITY_DISABLED','多 Agent 交接在 P1 启用',501);
    throw err('TOOL_NOT_FOUND',`Unknown agent tool: ${name}`,404);
  }
  const tools=['project.get_context','project.get_next_work','project.watch_changes','task.claim','task.upsert','task.transition','task.release','progress.report','evidence.attach','issue.raise_blocker','decision.request','handoff.submit'];
  return {createOpportunity,brief,startExperiment,getFullProject,ownerDecision,saveContent,reviewContent,addLedger,summaryLedger,tool,tools,store};
}
