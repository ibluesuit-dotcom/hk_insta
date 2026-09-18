import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sessions } from "../server/sessions";

test("sessions survive restart while expiry, account changes and logout remain enforced", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-sessions-"));
  try {
    const file = path.join(dir, "sessions.json");
    const first = new Sessions(file, "account-hash");
    first.issue("private-session-token", Date.now() + 60_000, "");
    assert.equal(
      fs.readFileSync(file, "utf8").includes("private-session-token"),
      false,
    );
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const restarted = new Sessions(file, "account-hash");
    assert.equal(restarted.has("private-session-token"), true);
    assert.equal(restarted.has("unknown"), false);
    assert.equal(
      new Sessions(file, "changed-account").has("private-session-token"),
      false,
    );
    restarted.issue("new-token", Date.now() + 60_000, "private-session-token");
    assert.equal(
      new Sessions(file, "account-hash").has("private-session-token"),
      false,
    );
    restarted.revoke("new-token");
    assert.equal(new Sessions(file, "account-hash").has("new-token"), false);
    restarted.issue("expired", Date.now() - 1, "");
    assert.equal(new Sessions(file, "account-hash").has("expired"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
