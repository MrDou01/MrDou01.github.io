import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const expected=JSON.parse(await fs.readFile('cloud/data/radar-data.json','utf8'));
const origin='https://mrdou01.github.io';
let good=false;
for(let attempt=0;attempt<8;attempt++){
 try{
  const r=await fetch(origin+'/cloud/data/radar-data.json?verification='+Date.now(),{signal:AbortSignal.timeout(20000)});
  assert(r.ok,'Data endpoint unavailable');const data=await r.json();
  assert.equal(data.profile.updatedAt,expected.profile.updatedAt);
  assert.equal(data.jobs.length,expected.jobs.length);
  assert.equal(data.cloudStatus?.completedAt,expected.cloudStatus?.completedAt);
  const homepage=await fetch(origin+'/?verification='+Date.now(),{signal:AbortSignal.timeout(20000)});assert(homepage.ok);
  const html=await homepage.text();
  const assets=[...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map(x=>new URL(x[1],origin));
  assert(assets.some(u=>u.pathname.endsWith('.js')));
  for(const url of assets){const res=await fetch(url,{signal:AbortSignal.timeout(20000)});assert(res.ok,'Asset unavailable');}
  console.log(JSON.stringify({published:true,jobs:data.jobs.length,updatedAt:data.profile.updatedAt,assets:assets.length}));good=true;break;
 }catch(e){if(attempt===7)throw e;await new Promise(resolve=>setTimeout(resolve,15000));}
}
assert(good);
