// GitHub evidence is checked against GitHub itself, never against an Agent's report.
const gh = async (path,token)=>{
  const r=await fetch(`https://api.github.com${path}`,{headers:{'Accept':'application/vnd.github+json','User-Agent':'opportunity-radar/0.1',...(token?{'Authorization':`Bearer ${token}`}:{})},signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw new Error(`GitHub API returned ${r.status} (${path})`);
  return r.json();
};
export async function verifyGitHubEvidence(e,token=process.env.GITHUB_TOKEN){
  if(!e.commitSha||!(/^[0-9a-f]{40}$/i.test(e.commitSha)))return {state:'unverified',reason:'需要完整40位 commit SHA'};
  const url=e.sourceUri||'';
  const m=/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:commit\/([0-9a-f]{40})|pull\/(\d+))(?:[/?#].*)?$/i.exec(url);
  if(!m)return {state:'unverified',reason:'只接受 GitHub commit/PR 正式地址'};
  const [,owner,repo,commitInUrl,pr]=m;
  try {
    if(commitInUrl && commitInUrl.toLowerCase()!==e.commitSha.toLowerCase())return {state:'unverified',reason:'URL commit SHA 与提交的 SHA 不一致'};
    if(pr){const p=await gh(`/repos/${owner}/${repo}/pulls/${pr}`,token);if(p.head?.sha?.toLowerCase()!==e.commitSha.toLowerCase())return {state:'unverified',reason:'当前 PR head SHA 与交付版本不一致'};}
    const commit=await gh(`/repos/${owner}/${repo}/commits/${e.commitSha}`,token);
    if(commit.sha?.toLowerCase()!==e.commitSha.toLowerCase())return {state:'unverified',reason:'GitHub 未返回匹配的 commit SHA'};
    const checks=await gh(`/repos/${owner}/${repo}/commits/${e.commitSha}/check-runs?per_page=100`,token);
    const runs=checks.check_runs||[];
    const required=(process.env.RADAR_REQUIRED_CHECKS||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(!required.length)return {state:'pending',reason:'尚未配置 RADAR_REQUIRED_CHECKS（当前项目的必需 CI 检查名称），不得自动通过 G1'};
    const missing=required.filter(name=>!runs.some(r=>r.name===name));
    if(missing.length)return {state:'pending',reason:`提交版本缺少必需检查：${missing.join('、')}`};
    if(checks.total_count>100)return {state:'pending',reason:'检查数量超过单次查询范围，需要完整分页核验'};
    if(!runs.length)return {state:'pending',reason:'GitHub 对此 SHA 没有可见的 Check Run；未满足 G1'};
    const failed=runs.filter(r=>r.status!=='completed'||r.conclusion!=='success');
    if(failed.length)return {state:'unverified',reason:`${failed.length} 项检查尚未成功：${failed.map(x=>x.name).slice(0,4).join('、')}`};
    return {state:'verified',reason:`GitHub commit ${e.commitSha.slice(0,7)} 与 ${runs.length} 项成功 Check Run 已核实`,checks:runs.map(r=>({name:r.name,conclusion:r.conclusion,headSha:r.head_sha,htmlUrl:r.html_url}))};
  }catch(error){return {state:'pending',reason:`无法核验 GitHub：${error.message}`};}
}
