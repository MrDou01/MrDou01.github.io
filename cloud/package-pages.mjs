import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('_site');
await fs.mkdir(output,{recursive:true});
for(const name of ['index.html','assets','favicon.svg','og.png','.nojekyll']){
  try{await fs.cp(name,path.join(output,name),{recursive:true});}catch(e){if(e.code!=='ENOENT'||['index.html','assets'].includes(name))throw e;}
}
await fs.cp('cloud/data',path.join(output,'cloud/data'),{recursive:true});
const data=JSON.parse(await fs.readFile('cloud/data/radar-data.json','utf8'));
if(!data.profile||!Array.isArray(data.jobs)||data.jobs.length<565)throw new Error('Incomplete cloud data');
const html=await fs.readFile(path.join(output,'index.html'),'utf8');
if(!html.includes('assets/'))throw new Error('Built protected app missing');
console.log(JSON.stringify({publishedJobs:data.jobs.length,updatedAt:data.profile.updatedAt}));
