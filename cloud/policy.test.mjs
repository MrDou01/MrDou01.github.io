import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDelta,expireJobs,validDate,officialURL} from './policy.mjs';
import {classifyBody,fetchOfficial,extractLinks} from './crawl.mjs';
const hosts=['jobs.example.com'];
const source='https://jobs.example.com/campus/detail/one';
const base=()=>({profile:{updatedAt:'2026-11-09'},jobs:[{id:'old-one',employer:'某单位',role:'会计',source,region:'宁波',stage:'active',priority:90,requirements:'2027届应届，专业不限，硕士。',audience:'2027届',education:'硕士',deadline:'2026-11-20',deadlineTime:'17:00',checkedAt:'2026-11-09',manualReview:'用户亲自填写',followStatus:'关注'}],scoreTrends:[{value:71.5,source:'historical'}],nearbyRegions:[],officialSources:[],updates:[]});
const evidence=(more={})=>({kind:'official',url:source,observedAt:'2026-11-14',excerpt:'2027届应届毕业生，本科及以上，专业不限，无工作经验要求。',...more});
const delta=(more={})=>({schemaVersion:1,id:'research-2026-11-14-001',date:'2026-11-14',jobs:[],patches:[],sources:[],updates:[],...more});
const opts={date:'2026-11-14',hosts};
const newJob=(more={})=>({id:'new-one',employer:'某单位',role:'会计',source,region:'宁波',stage:'active',priority:90,requirements:'2027届应届，专业不限，硕士。',audience:'2027届',education:'硕士',deadline:'2026-12-01',checkedAt:'2026-11-14',eligibility:{graduationYear:2027,majorScope:'unrestricted',experienceRequired:false},evidence:evidence(),...more});

test('merge preserves all old records, scores and user-maintained fields',()=>{
 const b=base(),r=applyDelta(b,delta({jobs:[newJob()]}),opts);
 assert.equal(r.data.jobs.length,2);assert.deepEqual(r.data.scoreTrends,b.scoreTrends);assert.equal(r.data.jobs[0].manualReview,'用户亲自填写');assert.equal(r.data.jobs[0].followStatus,'关注');assert.equal(b.jobs.length,1);assert.equal(r.data.jobs[1].stage,'active');
});
test('bare 会计学/财务管理 is consult even when claimed eligible',()=>{
 const j=newJob({requirements:'2027届，会计学、财务管理。',evidence:evidence({excerpt:'2027届应届毕业生，招聘专业为会计学、财务管理，工作地点宁波。'})});
 const r=applyDelta(base(),delta({jobs:[j]}),opts).data.jobs.at(-1);
 assert.equal(r.stage,'watch');assert.equal(r.match,'需咨询');assert.match(r.status,/专业需咨询/);
});
test('campus without explicit 2027 is never activated',()=>{
 const r=applyDelta(base(),delta({jobs:[newJob({evidence:evidence({excerpt:'校园招聘，应届毕业生，本科及以上，专业不限，工作地点宁波。'})})]}),opts).data.jobs.at(-1);
 assert.equal(r.stage,'watch');
});
test('hard experience excludes; priority experience does not imply hard exclusion',()=>{
 const hard=applyDelta(base(),delta({jobs:[newJob({evidence:evidence({excerpt:'2027届应届毕业生，专业不限；须具有3年以上相关工作经验；本科及以上。'})})]}),opts).data.jobs.at(-1);
 assert.equal(hard.stage,'excluded');
 const soft=applyDelta(base(),delta({jobs:[newJob({evidence:evidence({excerpt:'2027届应届毕业生，专业不限；具有3年以上相关工作经验者优先；本科及以上。'})})]}),opts).data.jobs.at(-1);
 assert.notEqual(soft.stage,'excluded');
});
test('partial status proof keeps qualification date',()=>{
 const r=applyDelta(base(),delta({patches:[{id:'old-one',stage:'expired',status:'职位已下线',evidence:evidence({scope:'status',excerpt:'该具体职位的页面显示职位已下线，未返回原任职资格正文。'})}]}),opts).data.jobs[0];
 assert.equal(r.checkedAt,'2026-11-09');assert.equal(r.statusCheckedAt,'2026-11-14');assert.equal(r.stage,'expired');
});
test('partial note patch never silently downgrades an existing active job',()=>{
 const r=applyDelta(base(),delta({patches:[{id:'old-one',note:'报名仍应尽早完成。',evidence:evidence({scope:'announcement',excerpt:'该单位报名公告显示办理材料需提前准备，具体岗位原有资格条件未作本次复核。'})}]}),opts).data.jobs[0];
 assert.equal(r.stage,'active');assert.equal(r.checkedAt,'2026-11-09');
});
test('qualification dates require full qualification scope on patches',()=>{
 assert.throws(()=>applyDelta(base(),delta({patches:[{id:'old-one',checkedAt:'2026-11-14',evidence:evidence({scope:'status'})}]}),opts),/qualification scope/);
});
test('closed jobs cannot reopen merely because a page loaded',()=>{
 const b=base();b.jobs[0].stage='expired';
 assert.throws(()=>applyDelta(b,delta({patches:[{id:'old-one',stage:'active',eligibility:{graduationYear:2027,majorScope:'unrestricted',experienceRequired:false},evidence:evidence()}]}),opts),/Reopening/);
});
test('known precision may not be erased or silently extended',()=>{
 for(const patch of [{deadlineTime:''},{deadlineTime:'23:59'},{deadline:'2026-11-21'}])assert.throws(()=>applyDelta(base(),delta({patches:[{id:'old-one',...patch,evidence:evidence()}]}),opts),/deadline|Deadline/);
});
test('deadline expiration uses Asia/Shanghai and preserves checkedAt',()=>{
 const b=base();b.jobs[0].deadline='2026-11-14';
 assert.equal(expireJobs(b,new Date('2026-11-14T08:59:59Z')).length,0);
 assert.equal(expireJobs(b,new Date('2026-11-14T09:00:01Z')).length,1);
 assert.equal(b.jobs[0].checkedAt,'2026-11-09');assert.equal(b.jobs[0].statusUpdatedAt,'2026-11-14');
});
test('invalid dates and numeric long IDs cannot corrupt canonical data',()=>{
 assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-99-01'),false);
 assert.throws(()=>applyDelta(base(),delta({jobs:[newJob({code:13302007007000012})]}),opts),/identifiers/);
 assert.throws(()=>applyDelta(base(),delta({date:'2027-01-01'}),opts),/date/);
});
test('private fields, unknown source origins and prototype fields are rejected',()=>{
 assert.throws(()=>applyDelta(base(),delta({patches:[{id:'old-one',manualReview:'overwrite',evidence:evidence()}]}),opts),/Private/);
 assert.equal(officialURL('http://127.0.0.1/a',hosts),false);assert.equal(officialURL('https://jobs.example.com@evil.test/a',hosts),false);
 assert.equal(officialURL('file:///secret',hosts),false);
 assert.throws(()=>applyDelta(base(),delta({jobs:[newJob({source:'https://unverified.test/job'})]}),opts),/approved/);
});
test('network failure leaves data unchanged and challenge/empty pages are not success',async()=>{
 const b=base(),snapshot=JSON.stringify(b);
 const r=await fetchOfficial({url:source},{hosts,fetchImpl:async()=>{throw new Error('network down');}});
 assert.equal(r.ok,false);assert.equal(JSON.stringify(b),snapshot);
 assert.equal(classifyBody('<html><script>load()</script></html>','text/html'),'empty-or-javascript');
 assert.equal(classifyBody('Just a moment - CAPTCHA check','text/html'),'blocked');
 const red=await fetchOfficial({url:source},{hosts,fetchImpl:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})});
 assert.equal(red.error,'redirect-outside-approved-origin');
});
test('new links omit candidate result lists and foreign origins',()=>{
 const links=extractLinks('<a href="/notice">2027财务招聘</a><a href="/names">拟录用名单公示</a><a href="http://127.0.0.1/test">财务招聘</a>',source,hosts);
 assert.deepEqual(links,[{url:'https://jobs.example.com/notice',title:'2027财务招聘'}]);
});
test('a rejected transaction leaves the original dataset untouched',()=>{
 const b=base(),before=JSON.stringify(b);assert.throws(()=>applyDelta(b,delta({jobs:[newJob(),newJob({id:'bad-job',source:'http://127.0.0.1/'})]}),opts));assert.equal(JSON.stringify(b),before);
});

test('explicit official reopening may move a historical deadline forward',()=>{
 const b=base();b.jobs[0].stage='expired';b.jobs[0].deadline='2026-11-01';
 const r=applyDelta(b,delta({patches:[{id:'old-one',stage:'active',deadline:'2026-12-01',eligibility:{graduationYear:2027,majorScope:'unrestricted',experienceRequired:false},evidence:evidence({change:'reopened',excerpt:'2027届应届毕业生，专业不限；恢复报名，延期至2026年12月1日17:00截止，本科及以上，无经验要求。'})}]}),opts);
 assert.equal(r.data.jobs[0].stage,'active');assert.equal(r.data.jobs[0].deadline,'2026-12-01');
});

test('explicit rejection of 125300 cannot be activated by a claimed eligibility flag',()=>{
 for(const restriction of ['不接受125300','专业不含会计专硕（125300）','125300不得报考']) {
  const j=newJob({evidence:evidence({excerpt:'2027届应届毕业生，本科及以上；'+restriction+'；其余专业不限，工作地点宁波。'})});
  const r=applyDelta(base(),delta({jobs:[j]}),opts).data.jobs.at(-1);assert.equal(r.stage,'excluded');assert.match(r.status,/不接受/);
 }
});
test('explicit male and directed-grassroots restrictions are excluded for the saved applicant profile',()=>{
 for(const restriction of ['限男性','性别要求：男','面向服务基层项目人员','仅限大学生村官']) {
  const j=newJob({evidence:evidence({excerpt:'2027届应届毕业生，专业不限；'+restriction+'；本科及以上，工作地点宁波。'})});
  assert.equal(applyDelta(base(),delta({jobs:[j]}),opts).data.jobs.at(-1).stage,'excluded');
 }
});
test('unrestricted genders and priority preferences are not mistaken for hard exclusions',()=>{
 for(const restriction of ['男女不限','性别不限','中共党员优先','服务基层项目人员优先','并非仅限服务基层项目人员']) {
  const j=newJob({evidence:evidence({excerpt:'2027届应届毕业生，专业不限；'+restriction+'；本科及以上，工作地点宁波。'})});
  assert.equal(applyDelta(base(),delta({jobs:[j]}),opts).data.jobs.at(-1).stage,'active');
 }
});
