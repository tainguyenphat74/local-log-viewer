import type { Files } from "./files.js";
import { readChunk } from "./read.js";
export function watchFile(
  files: Files,
  fileId: string,
  emit: (value: unknown) => void,
  interval = 500,
) {
  let stopped = false,
    busy = false,
    identity = "",
    size = -1,
    mtime = -1,
    cursor = 0;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const h = await files.handle(fileId);
      let stat;
      try {
        stat = await h.stat();
      } finally {
        await h.close();
      }
      const current = stat.dev + ":" + stat.ino;
      if (
        current !== identity ||
        stat.size !== size ||
        stat.mtimeMs !== mtime
      ) {
        const reset =
          current !== identity || stat.size < size || stat.size === size;
        const p = await readChunk(
          files,
          fileId,
          reset ? 0 : cursor,
          65536,
          "forward",
          reset,
        );
        if (stopped) return;
        identity = current;
        size = stat.size;
        mtime = stat.mtimeMs;
        const last = p.content.lastIndexOf("\n");
        cursor =
          last < 0
            ? p.startOffset
            : p.startOffset + Buffer.byteLength(p.content.slice(0, last + 1));
        // Catch up in bounded pages if a writer appended more than one page.
        if (p.nextOffset < size) {
          size = p.nextOffset;
          mtime = -1;
        }
        emit({ ...p, fileId, reset });
      }
    } catch {
      if (!stopped)
        emit({ fileId, error: "File unavailable; waiting for replacement" });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), interval);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
