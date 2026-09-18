import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Persist only token hashes; account changes invalidate previously issued sessions.
export class Sessions {
  private entries = new Map<string, number>();
  private account: string;

  constructor(
    private file: string,
    account: string,
  ) {
    this.account = digest(account);
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved.account === this.account && Array.isArray(saved.entries)) {
        for (const entry of saved.entries) {
          if (
            Array.isArray(entry) &&
            /^[a-f0-9]{64}$/.test(entry[0]) &&
            Number.isFinite(entry[1]) &&
            entry[1] > Date.now()
          )
            this.entries.set(entry[0], entry[1]);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  has(token: string) {
    return !!token && (this.entries.get(digest(token)) || 0) > Date.now();
  }

  issue(token: string, expiry: number, previous: string) {
    this.entries.delete(digest(previous));
    this.entries.set(digest(token), expiry);
    this.persist();
  }

  revoke(token: string) {
    if (this.entries.delete(digest(token))) this.persist();
  }

  private persist() {
    for (const [key, expiry] of this.entries)
      if (expiry <= Date.now()) this.entries.delete(key);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify({ account: this.account, entries: [...this.entries] }),
      { mode: 0o600 },
    );
    fs.renameSync(tmp, this.file);
  }
}
