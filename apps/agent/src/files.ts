import { realpath, opendir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
export function contained(root: string, path: string) {
  const r = relative(root, path);
  return (
    r === "" || (!r.startsWith(".." + "/") && r !== ".." && !isAbsolute(r))
  );
}
export class Files {
  private ids = new Map<string, { rootId: string; path: string }>();
  private reverse = new Map<string, string>();
  constructor(public config: Config) {}
  roots() {
    return this.config.roots.map(({ id, name }) => ({ id, name }));
  }
  root(id: string) {
    const r = this.config.roots.find((r) => r.id === id);
    if (!r) throw Error("Unauthorized root");
    return r;
  }
  async resolve(rootId: string, path: string) {
    const root = this.root(rootId);
    const canonical = await realpath(root.path);
    if (canonical !== root.path) throw Error("Root changed");
    const resolved = await realpath(path);
    if (!contained(canonical, resolved)) throw Error("Outside approved root");
    return resolved;
  }
  async list(rootId: string, directoryId?: string) {
    const root = this.root(rootId);
    const entry = directoryId ? this.ids.get(directoryId) : undefined;
    if (directoryId && (!entry || entry.rootId !== rootId))
      throw Error("Unknown directory");
    const path = await this.resolve(rootId, entry?.path || root.path);
    const dir = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const actual = await realpath("/proc/self/fd/" + dir.fd);
      await this.resolve(rootId, actual);
      const entries = await opendir("/proc/self/fd/" + dir.fd);
      let count = 0;
      const result = [];
      for await (const e of entries) {
        if (++count > 10000) throw Error("Directory exceeds 10000 entries");
        if (e.isSymbolicLink() || (!e.isFile() && !e.isDirectory())) continue;
        const p = join(path, e.name);
        let id = this.reverse.get(p);
        if (!id) {
          if (this.ids.size >= 50000) throw Error("File index limit reached");
          id = randomUUID();
          this.ids.set(id, { rootId, path: p });
          this.reverse.set(p, id);
        }
        result.push({ id, name: e.name, directory: e.isDirectory() });
      }
      return result.sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
    } finally {
      await dir.close();
    }
  }
  async handle(id: string) {
    const entry = this.ids.get(id);
    if (!entry) throw Error("Unknown file");
    const path = await this.resolve(entry.rootId, entry.path);
    const h = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const actual = await realpath("/proc/self/fd/" + h.fd);
      await this.resolve(entry.rootId, actual);
      if (!(await h.stat()).isFile()) throw Error("Not a regular file");
      return h;
    } catch (e) {
      await h.close();
      throw e;
    }
  }
}
