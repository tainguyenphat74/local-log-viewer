import { z } from 'zod';
export const MAX_FRAME = 1024 * 1024;
const id = z.string().min(1).max(128);
const file = { fileId: id };
const range = { ...file, offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), limitBytes: z.number().int().min(1024).max(262144).default(65536), direction: z.enum(['forward','backward']).default('forward') };
const ops = {
 'folder.list': z.object({}).strict(),
 'folder.add': z.object({rootId:id}).strict(),
 'folder.remove': z.object({rootId:id}).strict(),
 'file.list': z.object({rootId:id, directoryId:id.optional()}).strict(),
 'file.read': z.object(range).strict(),
 'file.tail': z.object(file).strict(),
 'file.search': z.object({...file, query:z.string().min(1).max(256), regex:z.boolean().default(false)}).strict(),
 'file.watch.start': z.object(file).strict(),
 'file.watch.stop': z.object(file).strict(),
 'cancel': z.object({target:id}).strict()
};
export const envelope = z.object({requestId:id,type:z.enum(Object.keys(ops) as [keyof typeof ops,...(keyof typeof ops)[]]),payload:z.unknown()}).strict();
export function parseRequest(value:unknown) {
 const e=envelope.parse(value);
 return {...e,payload:ops[e.type].parse(e.payload)};
}
export type Request = ReturnType<typeof parseRequest>;
export const response = z.object({requestId:id,type:z.enum(['result','error','changed']),payload:z.unknown()}).strict();
export function decode(raw:string) { if(Buffer.byteLength(raw)>MAX_FRAME) throw Error('Frame too large'); return parseRequest(JSON.parse(raw)); }
