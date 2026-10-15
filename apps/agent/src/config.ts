import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
export const configSchema=z.object({roots:z.array(z.object({id:z.string(),name:z.string(),path:z.string()})),gateway:z.string().optional(),credential:z.string().optional(),agentId:z.string().optional()});
export type Config=z.infer<typeof configSchema>;
export const configPath=()=>process.env.LOGVIEW_CONFIG || join(homedir(),'.logview/config.json');
export async function loadConfig(path=configPath()):Promise<Config>{try{return configSchema.parse(JSON.parse(await readFile(path,'utf8')));}catch(e:any){if(e.code==='ENOENT')return {roots:[]};throw e;}}
export async function saveConfig(config:Config,path=configPath()){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path+'.tmp',JSON.stringify(config,null,2),{mode:0o600});await chmod(path+'.tmp',0o600);await rename(path+'.tmp',path);}
