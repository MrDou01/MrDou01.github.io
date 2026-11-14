import crypto from 'node:crypto';

export const LIVE_STAGES = new Set(['active', 'watch', 'upcoming']);
export const STAGES = new Set([...LIVE_STAGES, 'expired', 'reference', 'excluded']);
export const MUTABLE_FIELDS = new Set(('id year category employer role code officialPositionId officialJobAdId location region direction match status stage deadline deadlineTime deadlineDisplay deadlineInterpretation officialDeadlineRaw requirements education audience note action source backupSource verificationSource priority headcount headCount checkedAt deadlineCheckedAt statusCheckedAt statusUpdatedAt verificationScope evidenceLevel publishedAt').split(' '));
const PRIVATE_FIELD = /password|token|cookie|secret|authorization|人工|关注|manual|follow|attention/i;
const SECRET_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|sk-[A-Za-z0-9_-]{28,})\b/;
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
export const shanghaiDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
export function validDate(value) { if(typeof value !== 'string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value; }
export function assertPublic(value, depth = 0) {
  if (depth > 18) throw new Error('Input is too deeply nested');
  if (typeof value === 'string' && (value.length > 30000 || SECRET_VALUE.test(value))) throw new Error('Sensitive or oversized input rejected');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['__proto__','constructor','prototype'].includes(key) || PRIVATE_FIELD.test(key) || SECRET_VALUE.test(key)) throw new Error('Private or unsupported field rejected');
    assertPublic(child, depth+1);
  }
}
export function officialURL(value, hosts) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.port && !['80','443','18443'].includes(u.port))) return false;
    if (u.hostname === 'localhost' || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return false;
    if ([...u.searchParams.keys()].some(k => /token|password|secret|authorization|signature/i.test(k))) return false;
    return u.hostname.endsWith('.gov.cn') || hosts.includes(u.hostname);
  } catch { return false; }
}
export function assertData(data) {
  if (!data?.profile || !Array.isArray(data.jobs) || !Array.isArray(data.scoreTrends) || !Array.isArray(data.updates) || !Array.isArray(data.officialSources) || !Array.isArray(data.nearbyRegions)) throw new Error('Incomplete radar data');
  if (new Set(data.jobs.map(j => j.id)).size !== data.jobs.length || data.jobs.some(j => !j.id)) throw new Error('Duplicate or missing job ID');
}
function evidenceFor(item, date, hosts) {
  const ev = item.evidence;
  if (!ev || ev.kind !== 'official' || !officialURL(ev.url, hosts) || !validDate(ev.observedAt) || ev.observedAt > date || typeof ev.excerpt !== 'string' || ev.excerpt.trim().length < 20 || ev.excerpt.length > 5000) throw new Error('Official evidence is required for every job or patch');
  if (item.checkedAt && item.checkedAt !== ev.observedAt) throw new Error('checkedAt must equal the evidence date');
  return ev;
}
function eligibility(job, evidence) {
  const quoted = evidence.excerpt;
  const declared = job.eligibility || {};
  const yearClear = /2027\s*届|2027\s*年.{0,12}(?:应届|毕业生)|(?:应届|毕业生).{0,12}2027/.test(quoted);
  const majorClear = /专业不限|不限专业|125300|会计专业硕士|会计硕士专业学位|MPAcc/i.test(quoted);
  const compact=quoted.replace(/\s+/g,'');
  const majorDenied=/(?:不接受|不含|不包括|不招收|不招|不接收)[^；。\n]{0,16}(?:125300|会计专业硕士|会计硕士专业学位|会计专硕|MPAcc)|(?:125300|会计专业硕士|会计专硕|MPAcc)[（()）]*[^；。\n]{0,10}(?:不在招聘范围|不符合(?:本岗位)?(?:专业|报名)条件|不得报考|不能报考)/i.test(compact);
  const hardIdentityClauses=compact.split(/[；;\n。，]/).filter(s=>!/优先|加分/.test(s));
  const maleOnly=hardIdentityClauses.some(s=>/(?:仅限|限|只招|只限|性别(?:要求)?[:：为]?)(?:男性|男生|男)(?!女)/.test(s)&&!/男女不限|性别不限|不限性别/.test(s));
  const directedOnly=hardIdentityClauses.some(s=>/(?:仅限|只限|限定|面向|限|招录对象为|招聘对象为)[^；。\n]{0,18}(?:服务基层项目人员|基层服务项目人员|大学生村官|村社区干部|村[（(]社区[）)]干部)/.test(s)&&!/不限|不限定|并非仅限/.test(s));
  const excludedReason=majorDenied?'官方明确不接受会计专硕/125300':maleOnly?'官方限男性，与暂按女性筛选口径不符':directedOnly?'官方限定基层项目或基层定向身份，与当前筛选口径不符':'';
  const hardClauses = quoted.split(/[；;\n。，]/).filter(s=>! /优先|加分|不要求|无需|不限/.test(s)).join('；');
  const requiredExperience = /(?:至少|须|需|具备|具有|要求|不低于).{0,10}[一二三四五六七八九十1-9]\s*年.{0,12}(?:工作|从业|相关|管理)经验|[一二三四五六七八九十1-9]\s*年(?:及以上|以上)(?:工作|从业|相关|管理)经验/.test(hardClauses);
  const scoped = declared.graduationYear === 2027 && declared.experienceRequired === false && ['unrestricted', '125300'].includes(declared.majorScope);
  return { yearClear, majorClear, requiredExperience, excludedReason, activeAllowed: yearClear && majorClear && !requiredExperience && !excludedReason && scoped };
}
function normalizeItem(item, old, date, hosts) {
  if (!item || typeof item !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,180}$/.test(item.id || '')) throw new Error('Invalid job ID');
  for (const key of Object.keys(item)) if (!MUTABLE_FIELDS.has(key) && !['evidence','eligibility'].includes(key)) throw new Error('Unsupported job field');
  const ev = evidenceFor(item, date, hosts);
  const patch = Object.fromEntries(Object.entries(item).filter(([key]) => MUTABLE_FIELDS.has(key)));
  const out = {...old, ...patch};
  for (const key of ['employer','role','requirements','source','region']) if (typeof out[key] !== 'string' || !out[key].trim()) throw new Error(`Missing job field: ${key}`);
  if (!officialURL(out.source, hosts) || (out.backupSource && !officialURL(out.backupSource, hosts)) || (out.verificationSource && !officialURL(out.verificationSource, hosts))) throw new Error('Job source is not an approved official origin');
  if (!STAGES.has(out.stage)) throw new Error('Invalid stage');
  if (out.deadline && (!validDate(out.deadline) || out.deadline > '2030-12-31')) throw new Error('Invalid or placeholder deadline');
  if (out.deadlineTime && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$|^24:00(?::00)?$/.test(out.deadlineTime)) throw new Error('Invalid deadline time');
  if (!Number.isFinite(out.priority) || out.priority < 0 || out.priority > 100) throw new Error('Invalid priority');
  for (const key of ['checkedAt','deadlineCheckedAt','statusCheckedAt','statusUpdatedAt','publishedAt']) if (out[key] && (!validDate(out[key]) || out[key] > date)) throw new Error(`Invalid ${key}`);
  if (old?.checkedAt && ev.observedAt < old.checkedAt) throw new Error('Older evidence cannot replace a newer job');
  for(const k of ['code','officialPositionId','officialJobAdId'])if(item[k]!==undefined&&typeof item[k]!=='string')throw new Error('Position identifiers must be strings');
  const qualificationChange=!old || ['active','upcoming'].includes(item.stage) || ['requirements','audience','education','year'].some(k=>Object.hasOwn(item,k)&&item[k]!==old[k]);
  if(old&&item.checkedAt&&ev.scope!=='qualification')throw new Error('A full qualification scope is required to update checkedAt');
  const e = eligibility(item, ev);
  if (qualificationChange && LIVE_STAGES.has(out.stage)) {
    if(e.excludedReason) {
      out.stage='excluded'; out.match='低匹配'; out.status=e.excludedReason; out.priority=Math.min(out.priority,20);
    } else if (e.requiredExperience) {
      out.stage='excluded'; out.match='低匹配'; out.status='官方条件要求工作经验，暂不匹配应届生'; out.priority=Math.min(out.priority,20);
    } else if (!e.activeAllowed) {
      out.stage='watch'; out.match='需咨询'; out.priority=Math.min(out.priority,85);
      const reasons=[];
      if (!e.yearClear) reasons.push('2027届适用待确认');
      if (!e.majorClear) reasons.push('专业需咨询（125300未明确）');
      if (!reasons.length) reasons.push('完整个人资格需核对');
      out.status=[out.status || '官方岗位待核',...reasons].join('｜');
    }
  }
  if (old && ['expired','excluded','reference'].includes(old.stage) && LIVE_STAGES.has(out.stage)) {
    if (ev.change !== 'reopened' || !/延期|延长|恢复|重启|重新开放/.test(ev.excerpt) || !out.deadline || out.deadline < date) throw new Error('Reopening requires an explicit official reopening notice');
  }
  if (old?.deadline && out.deadline && out.deadline > old.deadline && (!['deadline-extended','reopened'].includes(ev.change) || !/延期|延长|截止|报名/.test(ev.excerpt))) throw new Error('Deadline extension needs explicit evidence');
  if (old?.deadline && item.deadline === '') throw new Error('Do not erase a known deadline');
  if(old?.deadlineTime && item.deadlineTime === '')throw new Error('Do not erase a known deadline time');
  if(old?.deadline && out.deadline===old.deadline && old.deadlineTime && out.deadlineTime && Date.parse(out.deadline+'T'+(out.deadlineTime.length===5?out.deadlineTime+':00':out.deadlineTime)+'+08:00')>Date.parse(old.deadline+'T'+(old.deadlineTime.length===5?old.deadlineTime+':00':old.deadlineTime)+'+08:00') && !['deadline-extended','reopened'].includes(ev.change))throw new Error('Same-day deadline extension needs explicit evidence');
  // User-maintained fields never enter the accepted patch allow-list.
  if(!old||item.checkedAt)out.checkedAt=ev.observedAt;
  else if(out.stage!==old.stage)out.statusCheckedAt=ev.observedAt;
  if(qualificationChange)out.evidenceLevel = '官方证据人工/云端研究核验；专业与个人资格以招聘单位为准';
  for(const key of ['location','direction','match','status','deadline','education','audience','note','action'])if(out[key]===undefined)out[key]='';
  out.verificationSource = ev.url;
  out.verificationScope = ev.excerpt;
  if (old && old.stage !== out.stage) out.statusUpdatedAt = date;
  return out;
}
export function applyDelta(data, delta, {date, hosts}) {
  assertData(data); assertPublic(delta);
  if (delta?.schemaVersion !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,150}$/.test(delta.id || '') || !validDate(delta.date) || delta.date > date) throw new Error('Invalid delta identity/date');
  for (const k of Object.keys(delta)) if (!['schemaVersion','id','date','jobs','patches','sources','updates','summary'].includes(k)) throw new Error('Unsupported delta field');
  for (const k of ['jobs','patches','sources','updates']) if (!Array.isArray(delta[k] || []) || (delta[k] || []).length > 500) throw new Error('Invalid delta array');
  const copy = structuredClone(data), index = new Map(copy.jobs.map((j,i)=>[j.id,i])), seen = new Set(), changes=[];
  for (const [kind, items] of [['jobs',delta.jobs||[]], ['patches',delta.patches||[]]]) for (const item of items) {
    if (seen.has(item.id)) throw new Error('Duplicate delta job'); seen.add(item.id);
    const i = index.get(item.id), old = i === undefined ? null : copy.jobs[i];
    if (kind === 'patches' && !old) throw new Error('Patch target missing');
    const next = normalizeItem(item, old, date, hosts);
    if (i === undefined) {index.set(next.id,copy.jobs.length);copy.jobs.push(next);} else copy.jobs[i]=next;
    changes.push({id:next.id,kind:old?'patched':'added',source:next.source,observedAt:item.evidence.observedAt,changedFields:Object.keys(next).filter(k=>JSON.stringify(next[k])!==JSON.stringify(old?.[k]))});
  }
  for (const s of delta.sources||[]) {
    if (!s.name || !officialURL(s.url,hosts)) throw new Error('Invalid official source');
    if (!copy.officialSources.some(x=>x.url===s.url)) copy.officialSources.push({name:s.name,url:s.url,group:s.group||'官方招聘来源'});
  }
  for (const u of delta.updates||[]) {
    if (u.date!==delta.date || !u.title || typeof u.detail!=='string' || u.detail.length>4000) throw new Error('Invalid update record');
    if (!copy.updates.some(x=>x.date===u.date&&x.title===u.title)) copy.updates.unshift({date:u.date,type:u.type||'官方核验',title:u.title,detail:u.detail});
  }
  assertData(copy);
  if (copy.jobs.length<data.jobs.length || JSON.stringify(copy.scoreTrends)!==JSON.stringify(data.scoreTrends)) throw new Error('Historical data loss prevented');
  return {data:copy,changes};
}
export function expireJobs(data, now = new Date()) {
  const date=shanghaiDate(now), expired=[];
  for (const job of data.jobs) {
    if (!LIVE_STAGES.has(job.stage)||!validDate(job.deadline)) continue;
    let time=job.deadlineTime || '23:59:59';
    if (/^\d{2}:\d{2}$/.test(time))time+=':00';
    const cutoff=Date.parse(job.deadline+'T'+time+'+08:00');
    if (!Number.isFinite(cutoff)||cutoff>=now.getTime())continue;
    expired.push({id:job.id,deadline:job.deadline,previousStage:job.stage});
    job.stage='expired'; job.status='已过已核实报名截止时间；未取得官方延期依据'; job.statusUpdatedAt=date; job.priority=Math.min(job.priority||20,20);
    job.action='不再按当前可投岗位推荐；已报名者关注后续考试、缴费或面试通知。';
  }
  return expired;
}
