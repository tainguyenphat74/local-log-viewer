import type { Files } from "./files.js";
const MAX_LINE = 262144;
export async function readChunk(
  files: Files,
  fileId: string,
  offset = 0,
  limitBytes = 65536,
  direction = "forward",
  tail = false,
) {
  const h = await files.handle(fileId);
  try {
    const stat = await h.stat();
    const size = stat.size;
    const backward = tail || direction === "backward";
    const end = tail ? size : Math.min(offset, size);
    const start = backward
      ? Math.max(0, end - limitBytes - MAX_LINE)
      : Math.min(offset, size);
    const b = Buffer.alloc(
      backward ? end - start : Math.min(size - start, limitBytes + MAX_LINE),
    );
    const { bytesRead } = await h.read(b, 0, b.length, start);
    const data = b.subarray(0, bytesRead);
    let a = 0,
      z = data.length;
    if (backward) {
      const desired = Math.max(0, end - limitBytes) - start;
      a = desired > 0 ? data.lastIndexOf(10, desired - 1) + 1 : 0;
      if (a === 0 && start > 0) {
        const prev = Buffer.alloc(1);
        await h.read(prev, 0, 1, start - 1);
        if (prev[0] !== 10) {
          const next = data.indexOf(10, desired);
          if (next < 0) throw Error("Line exceeds 256 KiB limit");
          a = next + 1;
        }
      }
      if (end < size && z && data[z - 1] !== 10) z = data.lastIndexOf(10) + 1;
    } else {
      if (start > 0 && data.length) {
        const prev = Buffer.alloc(1);
        await h.read(prev, 0, 1, start - 1);
        if (prev[0] !== 10) {
          const newline = data.indexOf(10);
          if (newline < 0) {
            if (start + data.length < size)
              throw Error("Line exceeds 256 KiB limit");
            a = data.length;
          } else a = newline + 1;
        }
      }
      const target = Math.min(data.length, a + limitBytes);
      if (target && data[target - 1] === 10) z = target;
      else {
        const next = data.indexOf(10, target);
        if (next >= 0) z = next + 1;
        else if (start + data.length < size) {
          z = data.lastIndexOf(10) + 1;
          if (z <= a) throw Error("Line exceeds 256 KiB limit");
        }
      }
    }
    z = Math.max(a, z);
    let boundary = a;
    for (
      let n = data.indexOf(10, boundary);
      n >= 0 && n < z;
      n = data.indexOf(10, boundary)
    ) {
      if (n - boundary > MAX_LINE) throw Error("Line exceeds 256 KiB limit");
      boundary = n + 1;
    }
    if (z - boundary > MAX_LINE) throw Error("Line exceeds 256 KiB limit");
    return {
      content: data.subarray(a, z).toString("utf8"),
      startOffset: start + a,
      nextOffset: start + z,
      size,
      eof: start + z >= size,
      identity: stat.dev + ":" + stat.ino,
    };
  } finally {
    await h.close();
  }
}
