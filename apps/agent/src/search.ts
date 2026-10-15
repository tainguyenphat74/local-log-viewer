import type { Files } from "./files.js";
// Deliberately restricted regex: literal alternatives with optional ^ and $ anchors.
// No quantifiers, groups, classes, escapes or wildcard: linear work per bounded line.
export function matcher(query: string, regex: boolean) {
  if (!regex) return (s: string) => s.includes(query);
  if (/[\\.*+?()[\]{}]/.test(query))
    throw Error("Regex supports only literal alternatives (|) and ^/$ anchors");
  const parts = query.split("|").map((p) => ({
    start: p.startsWith("^"),
    end: p.endsWith("$"),
    text: p.replace(/^\^/, "").replace(/\$$/, ""),
  }));
  if (parts.some((p) => !p.text || /[\^$]/.test(p.text)))
    throw Error("Invalid limited regex");
  return (s: string) =>
    parts.some((p) =>
      p.start && p.end
        ? s === p.text
        : p.start
          ? s.startsWith(p.text)
          : p.end
            ? s.endsWith(p.text)
            : s.includes(p.text),
    );
}
export async function search(
  files: Files,
  fileId: string,
  query: string,
  regex: boolean,
  signal: AbortSignal,
) {
  const match = matcher(query, regex);
  const h = await files.handle(fileId);
  const results: { offset: number; text: string }[] = [];
  let position = 0,
    pending = Buffer.alloc(0),
    lineOffset = 0,
    skipping = false,
    skippedLines = 0;
  const deadline = Date.now() + 15000;
  try {
    const size = (await h.stat()).size;
    const chunk = Buffer.alloc(65536);
    while (position < size) {
      signal.throwIfAborted();
      if (Date.now() > deadline)
        return {
          results,
          truncated: true,
          scannedBytes: position,
          skippedLines,
        };
      const { bytesRead } = await h.read(
        chunk,
        0,
        Math.min(chunk.length, size - position),
        position,
      );
      if (!bytesRead) break;
      position += bytesRead;
      const b = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      let a = 0;
      for (let n = b.indexOf(10, a); n >= 0; n = b.indexOf(10, a)) {
        if (!skipping && n - a > 262144) skippedLines++;
        if (!skipping && n - a <= 262144) {
          const text = b.subarray(a, n).toString("utf8");
          if (match(text)) {
            results.push({ offset: lineOffset, text: text.slice(0, 2000) });
            if (results.length >= 100)
              return {
                results,
                truncated: true,
                scannedBytes: position,
                skippedLines,
              };
          }
        }
        skipping = false;
        lineOffset += n + 1 - a;
        a = n + 1;
      }
      pending = b.subarray(a);
      if (pending.length > 262144) {
        lineOffset += pending.length;
        pending = Buffer.alloc(0);
        if (!skipping) skippedLines++;
        skipping = true;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (pending.length && !skipping) {
      const text = pending.toString("utf8");
      if (match(text))
        results.push({ offset: lineOffset, text: text.slice(0, 2000) });
    }
    return { results, truncated: false, scannedBytes: position, skippedLines };
  } finally {
    await h.close();
  }
}
