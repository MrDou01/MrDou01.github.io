import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import {applyDelta,assertData,expireJobs,hash,shanghaiDate,validDate,LIVE_STAGES} from './policy.mjs';
import {crawl} from './crawl.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}};
async function atomicJSON(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+crypto.randomUUID();await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(temp,file);}
export function researchContext(data,state,config,date) {
  const until=new Date(Date.parse(date)+7*86400000).toISOString().slice(0,10);
  return {schemaVersion:1,date,purpose:'供云端研究任务核验官方招聘。页面可读/哈希变化并不表示资格已复核。收件规则见 cloud/README.md。',profile:{graduation:'2027届',degree:'会计专业硕士',code:'125300',region:'宁波全域、舟山、绍兴、杭州、台州、嘉兴',screen:'暂按女性、应届、无基层定向身份；不推定专业包含125300'},dataUpdatedAt:data.profile.updatedAt,lastResearchAt:state.lastResearchAt||null,cloudStatus:data.cloudStatus,sources:config.sources,approvedSourceHosts:config.officialHosts,pendingLeads:Object.values(state.leads||{}).filter(l=>!l.resolvedAt).sort((a,b)=>b.firstSeenAt.localeCompare(a.firstSeenAt)).slice(0,100),upcomingDeadlines:data.jobs.filter(j=>LIVE_STAGES.has(j.stage)&&j.deadline&&j.deadline>=date&&j.deadline<=until).map(j=>({id:j.id,employer:j.employer,role:j.role,deadline:j.deadline,deadlineTime:j.deadlineTime||'',source:j.source,checkedAt:j.checkedAt,match:j.match})),recentUpdates:data.updates.slice(0,12),rejectedInbox:Object.values(state.rejected||{}).slice(-10),jobIndex:data.jobs.filter(j=>LIVE_STAGES.has(j.stage)).map(j=>({id:j.id,employer:j.employer,role:j.role,source:j.source,stage:j.stage,checkedAt:j.checkedAt}))};
}
export async function run(args=process.argv.slice(2)) {
  const flag=n=>args.includes(n), get=(n,otherwise)=>{const i=args.indexOf(n);return i<0?otherwise:args[i+1];};
  const now=new Date(),date=get('--date',shanghaiDate(now));
  if(!validDate(date)||date>shanghaiDate(now))throw new Error('Date must be a real current/past Asia/Shanghai date');
  const effectiveNow=date===shanghaiDate(now)?now:new Date(date+'T23:59:59+08:00');
  const dryRun=flag('--dry-run'),skipFetch=flag('--skip-fetch');
  const input=get('--input',path.join(root,'data/radar-data.json'));
  let data=await read(input);assertData(data);
  const before=structuredClone(data),config=await read(path.join(root,'sources.json'));
  const state=await read(path.join(root,'data/state.json'),{schemaVersion:1,sources:{},leads:{},processed:{},rejected:{},nbFacts:{}});
  for(const key of ['sources','leads','processed','rejected','nbFacts'])state[key]||={};
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8),audit={schemaVersion:1,runId,date,startedAt:now.toISOString(),inbox:[],changes:[],expired:[],checks:[]};
  let files=[];try{files=(await fs.readdir(path.join(root,'inbox'))).filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const file of files) {
    const full=path.join(root,'inbox',file),raw=await fs.readFile(full,'utf8'),digest=hash(raw),fingerprint=file+':'+digest;
    if(state.rejected[fingerprint])continue;
    try {
      if(raw.length>1500000)throw new Error('Inbox file too large');
      const delta=JSON.parse(raw);
      const prev=state.processed[delta.id];
      if(prev){if(prev.sha256!==digest)throw new Error('Processed delta ID is immutable; submit a new ID');continue;}
      const merged=applyDelta(data,delta,{date,hosts:config.officialHosts});data=merged.data;audit.changes.push(...merged.changes);
      state.processed[delta.id]={file,sha256:digest,date,acceptedAt:now.toISOString()};
      state.lastResearchAt=delta.date>=(state.lastResearchAt||'')?delta.date:state.lastResearchAt;
      audit.inbox.push({id:delta.id,file,sha256:digest,status:'accepted',changes:merged.changes.length});
      for(const rejected of Object.values(state.rejected))if(rejected.file===file)rejected.resolvedAt=date;
      for(const item of [...(delta.jobs||[]),...(delta.patches||[])])for(const lead of Object.values(state.leads))if(lead.url===item.evidence?.url||lead.jobId===item.id)lead.resolvedAt=date;
    } catch(e) {
      const rejection={file,sha256:digest,date,error:e instanceof SyntaxError?'Invalid JSON':String(e.message).slice(0,180)};state.rejected[fingerprint]=rejection;audit.inbox.push({...rejection,status:'rejected'});
    }
  }
  audit.expired=expireJobs(data,effectiveNow);
  let result={checks:[],leads:[],sources:state.sources};
  if(!skipFetch) {
    result=await crawl(data,config,state,date);audit.checks=result.checks;state.sources=result.sources;
    for(const lead of result.leads)if(!state.leads[lead.key])state.leads[lead.key]=lead;
    if(result.generatedDelta?.jobs?.length) {
      try{const merged=applyDelta(data,result.generatedDelta,{date,hosts:config.officialHosts});data=merged.data;audit.changes.push(...merged.changes);audit.adapter={status:'accepted',jobs:merged.changes.length};}
      catch(e){audit.adapter={status:'rejected',error:String(e.message).slice(0,180)};}
    }
  }
  audit.expired.push(...expireJobs(data,effectiveNow));
  const success=result.checks.filter(x=>x.ok).length,failed=result.checks.filter(x=>!x.ok).length,changed=result.checks.filter(x=>x.changed).length;
  const completed=new Date().toISOString();
  data.cloudStatus={mode:'cloud',checkedAt:now.toISOString(),completedAt:completed,lastSuccessfulAt:success?completed:before.cloudStatus?.lastSuccessfulAt||'',fetchedSources:success,failedSources:failed,changedSources:changed,pendingLeads:Object.values(state.leads).filter(x=>!x.resolvedAt).length,lastResearchAt:state.lastResearchAt||'',scope:skipFetch?'仅合并已核实研究增量与已知截止状态；本次未抓取官网':'官方公开页面/接口检查及新线索发现；抓取成功不等同完整资格复核，失败来源保留旧数据',rejectedInbox:Object.values(state.rejected).filter(x=>!x.resolvedAt).length};
  if(success||audit.changes.length||audit.expired.length) {
    if(date>=(data.profile.updatedAt||''))data.profile.updatedAt=date;
    const title='云端每日检查：'+success+'项来源可读，'+failed+'项待重试';
    const detail='已保留全部历史岗位与人工状态；'+audit.changes.filter(c=>c.kind==='added').length+'条新增候选，'+audit.expired.length+'条按已知截止转为已截止。官网新链接及内容变化保留待核验，未将访问成功写作岗位资格通过。'+(failed?'访问失败来源不作无新增或下线判断。':'');
    // One daily operational entry; preserve separately recorded substantive research updates.
    data.updates=data.updates.filter(x=>!(x.date===date&&x.cloudOperational===true));
    data.updates.unshift({date,type:'云端检查',title,detail,cloudOperational:true});
  }
  assertData(data);
  if(data.jobs.length<before.jobs.length||before.jobs.some(j=>!data.jobs.some(x=>x.id===j.id))||JSON.stringify(data.scoreTrends)!==JSON.stringify(before.scoreTrends))throw new Error('Historical records must not be lost');
  audit.completedAt=completed;audit.summary={totalJobs:data.jobs.length,added:audit.changes.filter(c=>c.kind==='added').length,patched:audit.changes.filter(c=>c.kind==='patched').length,expired:audit.expired.length,fetchedSources:success,failedSources:failed,changedSources:changed,newLeads:result.leads.length,inboxAccepted:audit.inbox.filter(x=>x.status==='accepted').length,inboxRejected:audit.inbox.filter(x=>x.status==='rejected').length};
  if(!dryRun) {
    // The immutable audit is written before the two current-state projections. A rerun is idempotent by delta ID/hash.
    const hist=path.join(root,'history',date);await fs.mkdir(hist,{recursive:true});
    await fs.writeFile(path.join(hist,runId+'.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
    await atomicJSON(path.join(root,'data/radar-data.json'),data);
    await atomicJSON(path.join(root,'data/state.json'),state);
    await atomicJSON(path.join(root,'data/research-context.json'),researchContext(data,state,config,date));
  }
  const unresolved=Object.values(state.rejected).filter(x=>!x.resolvedAt);
  for(const reject of unresolved)console.warn('::warning title=Rejected research delta::'+reject.file+' - '+reject.error.replace(/[\r\n%]/g,' '));
  console.log(JSON.stringify({date,dryRun,skipFetch,...audit.summary,unresolvedRejectedInbox:unresolved.length}));
  if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\n### Job radar daily check\n\n'+JSON.stringify(audit.summary)+'\n\nUnresolved rejected inbox files: '+unresolved.length+'. See cloud/data/research-context.json. Fetch success is not qualification verification.\n');
  return {data,state,audit};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)run().catch(e=>{console.error('Cloud refresh failed: '+String(e.message).slice(0,200));process.exitCode=1;});
