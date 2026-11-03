import test from "node:test";
import assert from "node:assert/strict";
import {
  canScore,
  endReason,
  providerClosure,
} from "../src/session-lifecycle.js";
test("feedback is independent of billing only after remote closure is proven", () => {
  for (const status of ["live", "connecting", "closing"])
    assert.equal(canScore({ status, remoteClosed: true }), false);
  assert.equal(canScore({ status: "unconfirmed", remoteClosed: false }), false);
  assert.equal(
    canScore({
      status: "unconfirmed",
      remoteClosed: true,
      recoveryRequired: true,
    }),
    false,
  );
  assert.equal(
    canScore({
      status: "unconfirmed",
      remoteClosed: true,
      recoveryRequired: false,
    }),
    true,
  );
  assert.equal(canScore({ status: "complete" }), true);
});
test("automatic shutdown reasons are bounded and distinct from manual stops", () => {
  assert.equal(endReason("heartbeat_failed"), "heartbeat_failed");
  assert.equal(endReason("ai_room_disconnected"), "ai_room_disconnected");
  assert.equal(endReason("arbitrary private text"), "manual");
  assert.equal(endReason(undefined), "manual");
});

test("remote finalization preserves the reason and distinguishes interrupted interviews", () => {
  for (const reason of [
    "connection_lost",
    "remote_hangup",
    "content",
    "expired",
    "close_requested",
  ]) {
    const r = { errors: [] };
    providerClosure(r, { reason }, false);
    assert.equal(r.providerCloseReason, reason);
    assert.equal(r.interrupted, true);
    assert.equal(r.stopReason, "provider_" + reason);
  }
  const normal = { errors: [], stopReason: "manual" };
  providerClosure(normal, { reason: "close_requested" }, true);
  assert.equal(normal.interrupted, undefined);
  assert.deepEqual(normal.errors, []);
  assert.equal(normal.stopReason, "manual");
  const unknown = { errors: [] };
  providerClosure(unknown, { reason: "private untrusted content" }, false);
  assert.equal(unknown.providerCloseReason, "unknown");
  assert.equal(unknown.errors[0].reason, "unknown");
});

test("expiry after the full interview is not an early interruption", () => {
  const r = { errors: [], started: Date.now() - 600001 };
  providerClosure(r, { reason: "expired" }, false);
  assert.equal(r.interrupted, undefined);
  assert.equal(r.providerCloseReason, "expired");
});
