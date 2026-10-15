import {randomBytes,createHash,timingSafeEqual,scryptSync,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
export const token=()=>randomBytes(32).toString('base64url');
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export class Auth {
 private salt=randomBytes(16);
 private password:Buffer;
 sessions=new Map<string,{csrf:string,expires:number}>();
 pairings=new Map<string,number>();
 agents=new Map<string,{digest:string,name:string}>();
 attempts=new Map<string,{count:number,until:number}>();
 constructor(password:string,private statePath:string){if(password.length<12)throw Error('LOGVIEW_PASSWORD must contain at least 12 characters');this.password=scryptSync(password,this.salt,32);}
 async load(){try{const entries=JSON.parse(await readFile(this.statePath,'utf8'));for(const [id,a] of entries)this.agents.set(id,a);}catch(e:any){if(e.code!=='ENOENT')throw e;}}
 private writes=Promise.resolve();
 save(){this.writes=this.writes.then(async()=>{await mkdir(dirname(this.statePath),{recursive:true,mode:0o700});await writeFile(this.statePath+'.tmp',JSON.stringify([...this.agents]),{mode:0o600});await chmod(this.statePath+'.tmp',0o600);await rename(this.statePath+'.tmp',this.statePath);});return this.writes;}
 allow(ip:string){const now=Date.now();for(const [key,a] of this.attempts)if(a.until<now)this.attempts.delete(key);let a=this.attempts.get(ip);if(!a){if(this.attempts.size>=10000)return false;a={count:0,until:now+60000};this.attempts.set(ip,a);}return ++a.count<=10;}
 login(password:string){if(!timingSafeEqual(scryptSync(password,this.salt,32),this.password))throw Error('Invalid credentials');for(const [k,s] of this.sessions)if(s.expires<Date.now())this.sessions.delete(k);if(this.sessions.size>=100)throw Error('Session limit');const id=token();const session={csrf:token(),expires:Date.now()+8*3600000};this.sessions.set(hash(id),session);return {id,...session};}
 session(cookie=''){const id=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('logview='))?.slice(8);const s=id?this.sessions.get(hash(id)):undefined;return s&&s.expires>Date.now()?s:undefined;}
 logout(cookie=''){const id=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('logview='))?.slice(8);if(id)this.sessions.delete(hash(id));}
 pairing(){for(const [k,t] of this.pairings)if(t<Date.now())this.pairings.delete(k);if(this.pairings.size>=10)throw Error('Pairing limit');const code=token();this.pairings.set(hash(code),Date.now()+120000);return code;}
 async claim(code:string,name:string){const key=hash(code),expires=this.pairings.get(key);if(!expires||expires<Date.now())throw Error('Invalid or expired pairing');this.pairings.delete(key);if(this.agents.size>=20)throw Error('Agent limit');const id=randomUUID(),credential=token();this.agents.set(id,{digest:hash(credential),name});await this.save();return {agentId:id,credential};}
 agent(authorization=''){const match=/^Bearer ([^:]+):(.+)$/.exec(authorization);if(!match)return;const a=this.agents.get(match[1]);if(a&&a.digest===hash(match[2]))return match[1];}
 async revoke(id:string){this.agents.delete(id);await this.save();}
}
