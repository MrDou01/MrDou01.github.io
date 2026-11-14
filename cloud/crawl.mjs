import {hash, officialURL, LIVE_STAGES, applyDelta} from './policy.mjs';

export function plainText(html) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}
export function classifyBody(text, contentType='') {
  if (/captcha|access denied|forbidden|安全验证|人机验证|验证码|访问过于频繁|请开启JavaScript|enable javascript|Just a moment|请求被拦截/i.test(text.slice(0,1200))) return 'blocked';
  if (/application\/pdf|application\/octet-stream|spreadsheet|application\/zip/i.test(contentType)) return 'attachment';
  if (text.length<100 || (!/json/i.test(contentType)&&plainText(text).length<80)) return 'empty-or-javascript';
  return 'readable';
}
export async function fetchOfficial(spec, {hosts, timeoutMs=12000, maxBytes=2000000, fetchImpl=fetch}={}) {
  if (!officialURL(spec.url,hosts)) return {ok:false,url:spec.url,error:'unapproved-origin'};
  for (let attempt=0;attempt<2;attempt++) {
    try {
      let current=spec.url, response;
      const signal=AbortSignal.timeout(timeoutMs);
      for (let redirects=0;redirects<5;redirects++) {
        response=await fetchImpl(current,{method:spec.method||'GET',headers:{'User-Agent':'NingboJobRadar/1.0 (+https://mrdou01.github.io/)','Accept':'text/html,application/json,application/pdf;q=0.8',...(spec.body?{'Content-Type':'application/json'}:{})},...(spec.body?{body:JSON.stringify(spec.body)}:{}),redirect:'manual',signal});
        if (![301,302,303,307,308].includes(response.status))break;
        const target=new URL(response.headers.get('location'),current).href;
        if (!officialURL(target,hosts))return {ok:false,url:spec.url,httpStatus:response.status,error:'redirect-outside-approved-origin'};
        current=target;
      }
      if (!response.ok) {
        if (attempt===0&&response.status>=500)continue;
        return {ok:false,url:spec.url,httpStatus:response.status,error:'http-'+response.status};
      }
      const chunks=[];let bytes=0;
      for await(const chunk of response.body) {bytes+=chunk.length;if(bytes>maxBytes)throw new Error('response-too-large');chunks.push(chunk);}
      const buffer=Buffer.concat(chunks),contentType=response.headers.get('content-type')||'';
      const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
      let body;try{body=new TextDecoder(charset||'utf-8').decode(buffer);}catch{body=buffer.toString('utf8');}
      const state=classifyBody(body,contentType);
      return {ok:state==='readable'||state==='attachment',url:spec.url,finalUrl:current,httpStatus:response.status,state,bytes,sha256:hash(buffer),contentType,body};
    } catch(e) {
      if(attempt===1)return {ok:false,url:spec.url,error:['TimeoutError','AbortError'].includes(e.name)?'timeout':e.message==='response-too-large'?'response-too-large':'network-error'};
    }
  }
}
export function extractLinks(html, base, hosts) {
  const items=[],seen=new Set();
  for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;try{url=new URL(m[1].replaceAll('&amp;','&'),base);url.hash='';}catch{continue;}
    const title=plainText(m[2]).slice(0,200);
    if(!/招聘|招录|选调|公务员|校招|财务|会计|审计|预算|司库/.test(title)||/拟录用|拟聘|录用公示|体检名单|面试成绩|资格复审名单/.test(title)||!officialURL(url.href,hosts)||seen.has(url.href))continue;
    seen.add(url.href);items.push({url:url.href,title});
    if(items.length>=100)break;
  }
  return items;
}
async function parallel(items,n,fn) {let index=0;const out=[];await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(index<items.length){const i=index++;out[i]=await fn(items[i],i);}}));return out;}
export function selectSources(data,config,date) {
  const explicit=config.sources.map(x=>({...x,kind:'listing'}));
  const active=data.jobs.filter(j=>LIVE_STAGES.has(j.stage));
  const seen=new Set(explicit.map(s=>s.url));const details=[];
  for(const j of active.sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999')||b.priority-a.priority)) {
    let url=j.verificationSource||j.source;
    if(!url||!officialURL(url,config.officialHosts)||seen.has(url)||/\/api\/position\/selectOne/.test(url))continue;
    if(/\.zhiye\.com\/(?:campus|social)\/detail/.test(url)) {
      const u=new URL(url),id=u.searchParams.get('jobAdId');
      if(id)url=u.origin+'/api/JobAd/GetJobAdInfo?jobAdId='+encodeURIComponent(id)+'&category=2&displayFields='+encodeURIComponent(JSON.stringify(['JobAdName','Org','Category','LocId','HeadCount','PostDate','EndTime','Degree','Duty','Require']));
    }
    if(seen.has(url))continue; seen.add(url);details.push({name:j.employer+' '+j.role,url,kind:'detail',jobId:j.id});
  }
  // Always inspect imminent deadlines; rotate the remaining details if the source list grows.
  const max=config.limits.maxDetails, urgent=details.filter(s=>{const j=active.find(j=>j.id===s.jobId);return j?.deadline&&j.deadline<=new Date(Date.parse(date)+7*86400000).toISOString().slice(0,10);});
  const rest=details.filter(s=>!urgent.includes(s)),offset=rest.length?(Math.floor(Date.parse(date)/86400000)*Math.max(1,max-urgent.length))%rest.length:0;
  const rotated=[...rest.slice(offset),...rest.slice(0,offset)];
  return [...explicit,...urgent,...rotated.slice(0,Math.max(0,max-urgent.length))];
}
function sanitizedResult(spec,r,previous,date) {
  const prior=previous?.[spec.url],changed=!!(r.ok&&prior?.sha256&&prior.sha256!==r.sha256);
  return {name:spec.name,url:spec.url,kind:spec.kind,jobId:spec.jobId,attemptedAt:date,ok:r.ok,httpStatus:r.httpStatus,state:r.state||r.error,sha256:r.sha256,bytes:r.bytes,changed,scope:r.ok?'仅公开页面/接口可读及内容摘要；不等同岗位资格复核':'访问未完成；保留历史岗位条件与核验日期'};
}
export async function crawl(data,config,state,date,{fetchImpl=fetch}={}) {
  const options={hosts:config.officialHosts,...config.limits,fetchImpl};
  const specs=selectSources(data,config,date),leads=[],newSources={...state.sources},checks=[];
  await parallel(specs,config.limits.concurrency,async spec=>{
    const r=await fetchOfficial(spec,options),record=sanitizedResult(spec,r,state.sources,date);checks.push(record);
    if(!r.ok)return;
    if(r.state==='readable'&&spec.kind==='listing') {
      for(const link of extractLinks(r.body,r.finalUrl||spec.url,config.officialHosts)) {
        const key=hash(link.url);
        if(!(state.leads||{})[key])leads.push({...link,key,source:spec.url,firstSeenAt:date,status:'待核验：仅发现官方链接，未确认2027届/专业/期限'});
      }
    }
    if(record.changed&&spec.kind==='detail')leads.push({key:hash(spec.url+'|'+r.sha256),url:spec.url,title:spec.name,jobId:spec.jobId,source:spec.url,firstSeenAt:date,status:'具体岗位页面内容变化，须复核条件；页面变化也可能来自模板'});
    newSources[spec.url]={sha256:r.sha256,lastFetchedAt:date,name:spec.name};
  });
  const nb=await crawlNingboBank(data,options,date,state);
  checks.push(...nb.checks);leads.push(...nb.leads);
  for(const r of nb.checks)if(r.ok)newSources[r.url+'|'+(r.jobId||'')]={sha256:r.sha256,lastFetchedAt:date,name:r.name};
  return {checks,leads:[...new Map(leads.map(x=>[x.key,x])).values()],sources:newSources,generatedDelta:nb.delta};
}
async function crawlNingboBank(data,options,date,state) {
  const checks=[],leads=[],jobs=[];
  const listURL='https://zhaopin.nbcb.com.cn/api/position/schoolByPage/list';
  const all=[];let listComplete=false;
  for(let page=1;page<=5;page++) {
    const spec={name:'宁波银行校园岗位列表（第'+page+'页）',url:listURL,method:'POST',body:{page,pageSize:100,recruitmentType:1},kind:'structured-list'};
    const r=await fetchOfficial(spec,options);checks.push(sanitizedResult(spec,r,state.sources,date));
    if(!r.ok)break;
    let parsed;try{parsed=JSON.parse(r.body);}catch{checks.at(-1).ok=false;checks.at(-1).state='invalid-json';break;}
    if(parsed.status!=='0000'||!Array.isArray(parsed.data?.list)){checks.at(-1).ok=false;checks.at(-1).state='unexpected-schema';break;}
    all.push(...parsed.data.list);
    if(!parsed.data.hasNextPage){listComplete=true;break;}
  }
  const existing=new Map(data.jobs.filter(j=>j.officialPositionId).map(j=>[j.officialPositionId,j]));
  const target=/宁波|余姚|慈溪|奉化|宁海|象山|前湾|舟山|绍兴|杭州|台州|嘉兴/;
  const picked=all.filter(j=>existing.has(String(j.id))||(target.test([j.compName,j.workPlace,j.workCity,j.posName].join(' '))&&/财务|会计|审计|预算|资金|税务|内控|风控|司库|经营分析|绩效|综合管理|培训生|客户经理/.test(j.posName||''))).slice(0,40);
  await parallel(picked,3,async listed=>{
    const spec={name:'宁波银行 '+listed.posName,url:'https://zhaopin.nbcb.com.cn/api/position/selectOne',method:'POST',body:{id:String(listed.id)},kind:'structured-detail',jobId:existing.get(String(listed.id))?.id||String(listed.id)};
    const r=await fetchOfficial(spec,options);checks.push(sanitizedResult(spec,r,state.sources,date));
    if(!r.ok)return;
    const check=checks.at(-1);
    let p;try{p=JSON.parse(r.body);}catch{check.ok=false;check.state='invalid-json';return;}
    const d=p.data;
    if(p.status!=='0000'||!d||String(d.id)!==String(listed.id)||!d.posRequiRement){check.ok=false;check.state='unexpected-schema';return;}
    const regionText=[d.compName,d.workPlace,d.workCity,d.posName].join(' '),region=regionText.match(target)?.[0];
    const prior=existing.get(String(d.id));
    const facts={id:String(d.id),name:d.posName,org:d.compName,requirements:d.posRequiRement,duties:d.posDuty,status:d.posStatus,deadline:d.endTime};
    const fingerprint=hash(facts),key=hash(spec.url+'|'+d.id+'|'+fingerprint);
    const priorFingerprint=state.nbFacts?.[d.id];
    if(!prior||!priorFingerprint||priorFingerprint!==fingerprint)leads.push({key,url:spec.url,title:'宁波银行 '+d.compName+' '+d.posName,jobId:prior?.id,officialPositionId:String(d.id),request:{method:'POST',body:{id:String(d.id)}},source:listURL,firstSeenAt:date,status:prior?(priorFingerprint?'同ID结构字段变化，须复核':'首次云端读取同ID结构化详情，须与历史已核条件复核'):'官方校园岗位新线索，待完整资格复核',excerpt:String(d.posRequiRement).slice(0,700)});
    state.nbFacts||={};state.nbFacts[d.id]=fingerprint;
    // A new card is only added from a complete same-ID official detail and an explicit target region/year.
    // All adapter-discovered cards stay watch until the research task checks the entire personal eligibility.
    if(prior||!listComplete||String(d.posStatus)!=='1'||String(d.recruitmentType)!=='1'||!region||!/2027\s*届/.test(d.posRequiRement)||!target.test(regionText))return;
    if(/\d+年.{0,6}(?:工作|相关)经验/.test(d.posRequiRement))return;
    const end=String(d.endTime||'').slice(0,10),listEnd=String(listed.endTime||'').slice(0,10),deadline=/^202[67]-\d{2}-\d{2}$/.test(end)&&end===listEnd?end:'';
    if(deadline&&deadline<date)return;
    const id='cloud-nbcb-'+String(d.id).replace(/[^a-zA-Z0-9_-]/g,'')+'-2027';
    jobs.push({id,year:2027,category:'地方银行',employer:'宁波银行'+d.compName,role:d.posName,code:String(d.posHid||''),officialPositionId:String(d.id),region,location:regionText.replace(/null|undefined/g,'').trim(),direction:'金融国企',match:'需咨询',stage:'watch',priority:70,deadline,deadlineTime:'',officialDeadlineRaw:'列表：'+String(listed.endTime||'未给出')+'；详情：'+String(d.endTime||'未给出'),deadlineInterpretation:listed.endTime!==d.endTime?'列表与详情截止时点不一致，最终时点需向单位确认；建议在标注日期前一天完成。':'公开字段一致，仍以单位最终公告为准。',requirements:d.posRequiRement,education:d.education==='2'?'硕士及以上':d.education==='1'?'本科及以上':'以具体岗位为准',audience:'2027届应届毕业生',status:'云端发现官方具体校园岗位，个人资格待复核',note:'自动抓取官方同ID校园列表和完整详情；岗位方向及地点须以原文确认。不是投递成功或资格审核结论。',action:'打开官方校园招聘，按岗位名称/编号核对专业、工作地点、毕业窗口及最终截止后申请。',source:'https://zhaopin.nbcb.com.cn/#/campus-recruitment',verificationSource:spec.url,checkedAt:date,evidence:{kind:'official',url:spec.url,observedAt:date,excerpt:d.posName+'；'+d.compName+'；'+d.posRequiRement+'；'+String(d.posDuty||'').slice(0,1500)}});
  });
  return {checks,leads,delta:{schemaVersion:1,id:'adapter-nbcb-'+date,date,jobs,patches:[],sources:[],updates:jobs.length?[{date,type:'云端发现',title:'宁波银行新增'+jobs.length+'条官方校园岗位待核',detail:'云端已读取同ID校园列表和详情；保留为待核验候选，不推定125300或个人条件符合。'}]:[]}};
}
