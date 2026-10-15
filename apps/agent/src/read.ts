import type {Files} from './files.js';
export async function readChunk(files:Files,fileId:string,offset=0,limitBytes=65536,direction='forward',tail=false){
 const h=await files.handle(fileId);
 try{
 const stat=await h.stat();const size=stat.size;const end=tail?size:Math.min(offset,size);
 let start=tail||direction==='backward'?Math.max(0,end-limitBytes):Math.min(offset,size);
 const length=Math.min(size-start,limitBytes+262144);
 const b=Buffer.alloc(length);const {bytesRead}=await h.read(b,0,length,start);const data=b.subarray(0,bytesRead);
 let a=0;
 if(start>0){const prev=Buffer.alloc(1);await h.read(prev,0,1,start-1);if(prev[0]!==10){const n=data.indexOf(10);if(n<0)throw Error('Line exceeds 256 KiB limit');a=n+1;}}
 let target=tail||direction==='backward'?end-start:Math.min(data.length,a+limitBytes);
 let z=Math.min(target,data.length);
 if(z<data.length&&z>0&&data[z-1]!==10){const n=data.indexOf(10,z);if(n<0){if(start+data.length<size)throw Error('Line exceeds 256 KiB limit');z=data.length;}else z=n+1;}
 if(z-a>524288)throw Error('Line exceeds limit');
 const content=data.subarray(a,z).toString('utf8');
 return {content,startOffset:start+a,nextOffset:start+z,size,eof:start+z>=size,identity:stat.dev+':'+stat.ino};
 }finally{await h.close();}
}
