export async function api(path:string,method='GET',body?:unknown,csrf?:string){
 const res=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await res.json();if(!res.ok)throw Error(value.error||'Request failed');return value;
}
export class Client{
 ws?:WebSocket;stopped=false;timer?:ReturnType<typeof setTimeout>;
 pending=new Map<string,{resolve:(p:any)=>void,reject:(e:Error)=>void,timer:ReturnType<typeof setTimeout>,changed?:(p:any)=>void,agentId:string}>();
 constructor(private status:(online:boolean)=>void){this.connect();}
 connect(){if(this.stopped)return;const ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws/browser');this.ws=ws;
 ws.onopen=()=>this.status(true);
 ws.onmessage=e=>{try{const msg=JSON.parse(e.data),p=this.pending.get(msg.requestId);if(!p)return;if(msg.type==='changed'){p.changed?.(msg.payload);return;}clearTimeout(p.timer);if(msg.type==='error'){p.reject(Error(msg.payload.error));this.pending.delete(msg.requestId);this.status(false);setTimeout(()=>{if(ws.readyState===1)this.status(true);},1000);}else{p.resolve(msg.payload);if(!p.changed)this.pending.delete(msg.requestId);}}catch{ws.close();}};
 ws.onclose=()=>{this.status(false);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Disconnected'));}this.pending.clear();if(!this.stopped)this.timer=setTimeout(()=>this.connect(),1000);};
 }
 request(agentId:string,type:string,payload:unknown,changed?:(p:any)=>void){
 const id=crypto.randomUUID();
 const promise=new Promise<any>((resolve,reject)=>{
 if(this.ws?.readyState!==1){reject(Error('Connecting to gateway'));return;}
 const timer=setTimeout(()=>{this.cancel(id);reject(Error('Request timed out'));},20000);
 this.pending.set(id,{resolve,reject,timer,changed,agentId});this.ws.send(JSON.stringify({agentId,request:{requestId:id,type,payload}}));
 });
 return {id,promise,cancel:()=>this.cancel(id)};
 }
 cancel(id:string){const p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);this.pending.delete(id);p.reject(Error('Cancelled'));if(this.ws?.readyState===1)this.ws.send(JSON.stringify({agentId:p.agentId,request:{requestId:crypto.randomUUID(),type:'cancel',payload:{target:id}}}));}
 close(){this.stopped=true;clearTimeout(this.timer);this.ws?.close();}
}
