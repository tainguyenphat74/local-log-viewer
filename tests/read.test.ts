import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Files} from '../apps/agent/src/files.js';
import {readChunk} from '../apps/agent/src/read.js';
test('UTF8 byte pages and sparse multi-gigabyte tail stay bounded',async()=>{
 const dir=await mkdtemp(tmpdir()+'/logview-');try{
 const line='INFO café 🌍\n';await writeFile(dir+'/a',line.repeat(1000));
 const f=new Files({roots:[{id:'r',name:'r',path:dir}]});let [e]=await f.list('r');
 const p=await readChunk(f,e.id,0,1024);assert.ok(p.content.endsWith('\n'));assert.ok(!p.content.includes('�'));assert.equal(p.nextOffset,Buffer.byteLength(p.content));
 const q=await readChunk(f,e.id,p.nextOffset,1024);assert.equal(q.startOffset,p.nextOffset);
 const h=await open(dir+'/big','w');await h.truncate(3*1024**3);await h.write(Buffer.from('\n'+line),0,Buffer.byteLength('\n'+line),3*1024**3-Buffer.byteLength('\n'+line));await h.close();
 const big=(await f.list('r')).find(e=>e.name==='big')!;const t=await readChunk(f,big.id,0,65536,'forward',true);assert.equal(t.content,line);assert.equal(t.size,3*1024**3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
