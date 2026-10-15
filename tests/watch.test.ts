import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Files} from '../apps/agent/src/files.js';
import {watchFile} from '../apps/agent/src/watch.js';
const wait=async(fn:()=>boolean)=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
test('watch follows append, truncation and rotation',async()=>{
 const dir=await mkdtemp(tmpdir()+'/logview-');let stop=()=>{};try{
 await writeFile(dir+'/a','first\n');const f=new Files({roots:[{id:'r',name:'r',path:dir}]});const [e]=await f.list('r');const events:any[]=[];
 stop=watchFile(f,e.id,v=>events.push(v),10);await wait(()=>events.length>0);
 await appendFile(dir+'/a','next\n');await wait(()=>events.some(v=>v.content==='next\n'&&!v.reset));
 await writeFile(dir+'/a','x\n');await wait(()=>events.some(v=>v.content==='x\n'&&v.reset));
 await rename(dir+'/a',dir+'/old');await writeFile(dir+'/a','rotated\n');await wait(()=>events.some(v=>v.content==='rotated\n'&&v.reset));
 }finally{stop();await rm(dir,{recursive:true,force:true});}
});
