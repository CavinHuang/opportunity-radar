// External evidence is never verified from an Agent's self-report.
// Only the required checks for the exact SHA and repository can satisfy G1.
export async function verifyGitHubEvidence(e, token=process.env.GITHUB_TOKEN, options={}){
  const sha=String(e.commitSha||'');
  if(!/^[0-9a-f]{40}$/i.test(sha))return {state:'unverified',reason:'需要完整40位 commit SHA'};
  const match=/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:commit\/([0-9a-f]{40})|pull\/(\d+))(?:[/?#].*)?$/i.exec(e.sourceUri||'');
  if(!match)return {state:'unverified',reason:'只接受 GitHub commit/PR 正式地址'};
  const [,owner,repoName,shaInUrl,pr]=match;
  if(e.repo && e.repo.toLowerCase()!==`${owner}/${repoName}`.toLowerCase())return {state:'unverified',reason:'证据的仓库与地址不一致'};
  if(shaInUrl && shaInUrl.toLowerCase()!==sha.toLowerCase())return {state:'unverified',reason:'URL commit SHA 与交付 SHA 不一致'};

  const fetchImpl=options.fetchImpl||fetch;
  const required=(options.requiredChecks??process.env.RADAR_REQUIRED_CHECKS??'').split(',').map(s=>s.trim()).filter(Boolean);
  const gh=async path=>{
    const response=await fetchImpl(`https://api.github.com${path}`,{
      headers:{Accept:'application/vnd.github+json','User-Agent':'opportunity-radar/0.3',...(token?{Authorization:`Bearer ${token}`}:{})},
      signal:AbortSignal.timeout(9000)
    });
    if(!response.ok)throw new Error(`GitHub API returned ${response.status} (${path})`);
    return response.json();
  };
  try{
    if(pr){
      const pull=await gh(`/repos/${owner}/${repoName}/pulls/${pr}`);
      if(pull.head?.sha?.toLowerCase()!==sha.toLowerCase())return {state:'unverified',reason:'PR 最新 head SHA 与提交版本不一致'};
    }
    const commit=await gh(`/repos/${owner}/${repoName}/commits/${sha}`);
    if(commit.sha?.toLowerCase()!==sha.toLowerCase())return {state:'unverified',reason:'GitHub 未返回匹配的 commit SHA'};
    if(!required.length)return {state:'pending',reason:'尚未配置 RADAR_REQUIRED_CHECKS，不得自动通过 G1'};
    const response=await gh(`/repos/${owner}/${repoName}/commits/${sha}/check-runs?per_page=100`);
    if(response.total_count>100)return {state:'pending',reason:'检查超过100项，必须分页核查后才能验证'};
    const runs=response.check_runs||[];
    const selected=[];
    for(const name of required){
      const matches=runs.filter(r=>r.name===name);
      if(!matches.length)return {state:'pending',reason:`缺少必需检查：${name}`};
      const latest=[...matches].sort((a,b)=>Date.parse(b.started_at||b.created_at||0)-Date.parse(a.started_at||a.created_at||0))[0];
      if(latest.head_sha?.toLowerCase()!==sha.toLowerCase())return {state:'unverified',reason:`检查 ${name} 所属的提交版本不一致`};
      if(latest.status!=='completed')return {state:'pending',reason:`必需检查 ${name} 仍在运行`};
      if(latest.conclusion!=='success')return {state:'unverified',reason:`必需检查 ${name} 未通过：${latest.conclusion||'unknown'}`};
      selected.push(latest);
    }
    return {state:'verified',reason:`GitHub commit ${sha.slice(0,7)} 及 ${selected.length} 项指定 CI 检查已核实`,checks:selected.map(r=>({name:r.name,conclusion:r.conclusion,headSha:r.head_sha,htmlUrl:r.html_url,runId:r.id}))};
  }catch(error){return {state:'pending',reason:`无法核验 GitHub：${error.message}`};}
}
