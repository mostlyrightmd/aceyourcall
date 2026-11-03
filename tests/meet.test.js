import test from "node:test";
import assert from "node:assert/strict";
import { meetURL, options } from "../src/meet/config.js";
test("Meet links canonicalize only valid Google Meet codes", () => {
  assert.equal(
    meetURL("https://meet.google.com/meet/nnv-whjj-ivp"),
    "https://meet.google.com/nnv-whjj-ivp",
  );
  assert.equal(
    meetURL("https://meet.google.com/nnv-whjj-ivp?authuser=1"),
    "https://meet.google.com/nnv-whjj-ivp",
  );
  for (const url of [
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com.evil.test/abc-defg-hij",
    "https://meet.google.com:444/abc-defg-hij",
    "https://user@meet.google.com/abc-defg-hij",
    "https://meet.google.com/lookup/private",
  ])
    assert.throws(() => meetURL(url));
});
test("paid Meet mode requires consent and bounded duration", () => {
  assert.throws(() =>
    options(["--url", "https://meet.google.com/nnv-whjj-ivp", "--voice"]),
  );
  assert.throws(() =>
    options([
      "--url",
      "https://meet.google.com/nnv-whjj-ivp",
      "--seconds",
      "601",
    ]),
  );
  assert.equal(
    options([
      "--url",
      "https://meet.google.com/nnv-whjj-ivp",
      "--voice",
      "--consent",
      "--seconds",
      "60",
    ]).seconds,
    60,
  );
});
