import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Files} from '../apps/agent/src/files.js';
import {search,matcher} from '../apps/agent/src/search.js';
test('safe regex, byte offsets, and sparse search cancellation',async()=>{
 assert.throws(()=>matcher('(a+)+$',true));assert.ok(matcher('^INFO|ERROR$',true)('INFO hello'));
 const dir=await mkdtemp(tmpdir()+'/logview-');try{
 await writeFile(dir+'/a','é\nERROR test\n');const f=new Files({roots:[{id:'r',name:'r',path:dir}]});const [e]=await f.list('r');
 assert.equal((await search(f,e.id,'ERROR',false,new AbortController().signal)).results[0].offset,3);
 const h=await open(dir+'/big','w');await h.truncate(4*1024**3);await h.close();const big=(await f.list('r')).find(e=>e.name==='big')!;
 const controller=new AbortController();const before=process.memoryUsage().rss;const task=search(f,big.id,'absent',false,controller.signal);setTimeout(()=>controller.abort(),30);
 await assert.rejects(task);assert.ok(process.memoryUsage().rss-before<64*1024**2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
