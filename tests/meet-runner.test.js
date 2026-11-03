import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { meetingRunner } from "../src/meet/runner.js";
test("meeting shutdown stays pending until child exit, then clears; stuck child is escalated", async () => {
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  const runner = meetingRunner({
    spawnProcess: (command, args, opts) => {
      assert.equal(opts.detached, process.platform !== "win32");
      return child;
    },
    signalProcess: (p, s) => signals.push(s),
    stopTimeoutMs: 20,
  });
  runner.start({
    url: "https://meet.google.com/abc-defg-hij",
    profile: "speedrun-10",
    seconds: 60,
  });
  runner.stop();
  assert.equal(runner.state().running, true);
  assert.equal(runner.state().status, "stopping");
  assert.deepEqual(signals, ["SIGTERM"]);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  child.emit("close", 1);
  assert.equal(runner.state().running, false);
});

test("failed browser spawn clears running state on close", () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const runner = meetingRunner({
    spawnProcess: () => child,
    signalProcess: () => {},
  });
  runner.start({
    url: "https://meet.google.com/abc-defg-hij",
    profile: "speedrun-10",
    seconds: 60,
  });
  child.emit("error", new Error("spawn failed"));
  child.emit("close", 1);
  assert.equal(runner.state().running, false);
  assert.equal(runner.state().status, "needs_attention");
  assert.match(runner.state().error, /Could not start/);
});
