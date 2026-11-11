import assert from "node:assert/strict";
import test from "node:test";
import { runCommand } from "./run-command.mjs";

test("CLI subprocess receives stdin EOF when its prompt is an argument", async () => {
  const script = `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("closed"));`;
  const result = await runCommand(process.execPath, ["-e", script, "--", "prompt argument"], { timeout: 1000 });
  assert.equal(result.stdout, "closed");
});
