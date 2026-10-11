const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { storageUnavailable } = require("./report-errors");
const keyPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
class LocalReportStorage {
  constructor(root) { this.root = path.resolve(root); this.active = new Set(); this.lock = null; this.scanner = null; }
  location(key, temporary = false) {
    if (!keyPattern.test(key)) throw storageUnavailable();
    const filename = path.resolve(this.root, key + (temporary ? ".part" : ".blob"));
    if (path.dirname(filename) !== this.root) throw storageUnavailable();
    return filename;
  }
  async initialize() {
    try {
      await fsp.mkdir(this.root, { recursive: true, mode: 0o700 });
      const root = await fsp.lstat(this.root);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error();
      const lockPath = path.join(this.root, ".runtime.lock");
      try { this.lock = await fsp.open(lockPath, "wx", 0o600); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const pid = Number(await fsp.readFile(lockPath, "utf8"));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error();
        let alive = true;
        try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") alive = false; }
        if (alive) throw new Error();
        await fsp.unlink(lockPath);
        this.lock = await fsp.open(lockPath, "wx", 0o600);
      }
      await this.lock.writeFile(String(process.pid));
      if (process.platform !== "win32") await fsp.chmod(this.root, 0o700);
    } catch { throw storageUnavailable(); }
  }
  async close() {
    if (this.scanner) { await this.scanner.return(); this.scanner = null; }
    if (this.lock) { await this.lock.close(); this.lock = null; await fsp.unlink(path.join(this.root, ".runtime.lock")).catch(() => {}); }
  }
  begin(key) {
    if (this.active.has(key)) return false;
    this.active.add(key); return true;
  }
  end(key) { this.active.delete(key); }
  createTemporary(key) { return fs.createWriteStream(this.location(key, true), { flags: "wx", mode: 0o600 }); }
  async publish(key) { await fsp.rename(this.location(key, true), this.location(key)); }
  async remove(key) {
    for (const temporary of [true, false]) {
      try { await fsp.unlink(this.location(key, temporary)); }
      catch (error) { if (error.code !== "ENOENT") throw storageUnavailable(); }
    }
  }
  async open(key) {
    let handle;
    try {
      const filename = this.location(key);
      if ((await fsp.lstat(filename)).isSymbolicLink()) throw new Error();
      handle = await fsp.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error();
      return { handle, size: stat.size };
    } catch { await handle?.close().catch(() => {}); throw storageUnavailable(); }
  }
  async *entries() {
    const dir = await fsp.opendir(this.root);
    for await (const entry of dir) {
      const match = /^(.*)\.(part|blob)$/.exec(entry.name);
      if (entry.isFile() && match && keyPattern.test(match[1])) yield { key: match[1], name: entry.name };
    }
  }
  async scan(limit = 100) {
    if (!this.scanner) this.scanner = this.entries();
    const entries = [];
    for (let i = 0; i < limit; i++) {
      const next = await this.scanner.next();
      if (next.done) { this.scanner = null; break; }
      entries.push(next.value);
    }
    return entries;
  }
}
module.exports = { LocalReportStorage, keyPattern };
