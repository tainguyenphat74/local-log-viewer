import { z } from "zod";
export const MAX_FRAME = 1024 * 1024;
const id = z.string().min(1).max(128);
const file = { fileId: id };
const range = {
  ...file,
  offset: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
  limitBytes: z.number().int().min(1024).max(262144).default(65536),
  direction: z.enum(["forward", "backward"]).default("forward"),
};
const ops = {
  "folder.list": z.object({}).strict(),
  "folder.add": z.object({ rootId: id }).strict(),
  "folder.remove": z.object({ rootId: id }).strict(),
  "file.list": z.object({ rootId: id, directoryId: id.optional() }).strict(),
  "file.read": z.object(range).strict(),
  "file.tail": z.object(file).strict(),
  "file.search": z
    .object({
      ...file,
      query: z.string().min(1).max(256),
      regex: z.boolean().default(false),
    })
    .strict(),
  "file.watch.start": z.object(file).strict(),
  "file.watch.stop": z.object(file).strict(),
  cancel: z.object({ target: id }).strict(),
};
export const envelope = z
  .object({
    requestId: id,
    type: z.enum(
      Object.keys(ops) as [keyof typeof ops, ...(keyof typeof ops)[]],
    ),
    payload: z.unknown(),
  })
  .strict();
export function parseRequest(value: unknown) {
  const e = envelope.parse(value);
  return { ...e, payload: ops[e.type].parse(e.payload) };
}
export type Request = ReturnType<typeof parseRequest>;
const byteOffset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const chunkSchema = z
  .object({
    content: z.string().max(524288),
    startOffset: byteOffset,
    nextOffset: byteOffset,
    size: byteOffset,
    eof: z.boolean(),
    identity: z.string().max(128),
  })
  .strict();
const changedSchema = chunkSchema.extend({ fileId: id, reset: z.boolean() });
const errorSchema = z.object({ error: z.string().max(1024) }).strict();
const resultSchema = z.union([
  chunkSchema,
  z.array(z.object({ id, name: z.string().max(4096) }).strict()).max(1000),
  z
    .array(
      z
        .object({ id, name: z.string().max(4096), directory: z.boolean() })
        .strict(),
    )
    .max(10000),
  z.object({ selected: z.boolean() }).strict(),
  z.object({ watching: z.boolean() }).strict(),
  z
    .object({
      results: z
        .array(
          z.object({ offset: byteOffset, text: z.string().max(2000) }).strict(),
        )
        .max(100),
      truncated: z.boolean(),
      scannedBytes: byteOffset,
      skippedLines: z.number().int().nonnegative(),
    })
    .strict(),
]);
export const response = z.discriminatedUnion("type", [
  z
    .object({ requestId: id, type: z.literal("result"), payload: resultSchema })
    .strict(),
  z
    .object({ requestId: id, type: z.literal("error"), payload: errorSchema })
    .strict(),
  z
    .object({
      requestId: id,
      type: z.literal("changed"),
      payload: z.union([changedSchema, errorSchema.extend({ fileId: id })]),
    })
    .strict(),
]);
export function decode(raw: string) {
  if (Buffer.byteLength(raw) > MAX_FRAME) throw Error("Frame too large");
  return parseRequest(JSON.parse(raw));
}
