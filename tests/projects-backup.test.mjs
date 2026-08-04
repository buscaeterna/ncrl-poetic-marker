import assert from "node:assert/strict";
import test from "node:test";
import { makeBackup, validateBackup } from "../app/projects-dialog.tsx";

const workspace = { corpora: [{ encoding: "windows-1251", eol: "\r\n", originalSource: "текст", future: true }], poems: [], activeId: null, queue: [] };

test("project backup round-trips the complete workspace", () => {
  const backup = makeBackup({ schema_version: 1, name: "Проект", workspace });
  assert.equal(typeof backup.backed_up_at, "string");
  assert.deepEqual(validateBackup(backup), { schema_version: 1, name: "Проект", workspace });
});

test("invalid backup is rejected without producing a partial workspace", () => {
  assert.throws(() => validateBackup({ schema_version: 1, name: "bad", workspace: { corpora: [] } }), /Некорректная/);
});

test("creating a project resets jobs in the dialog implementation", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../app/projects-dialog.tsx", import.meta.url), "utf8"));
  assert.match(source, /setCurrent\(p\);setName\(p\.name\);setJobs\(\[\]\)/);
});
