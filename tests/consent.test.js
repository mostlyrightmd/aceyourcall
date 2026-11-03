import test from "node:test";
import assert from "node:assert/strict";
import {
  consentChoices,
  sharedUseAllowed,
  POLICY_VERSION,
} from "../src/consent.js";
const base = {
  version: POLICY_VERSION,
  terms: true,
  sales: false,
  improvement: false,
};
test("optional sales and improvement permission is explicit, versioned and not bundled with terms", () => {
  assert.throws(() => consentChoices({ terms: true }));
  assert.throws(() => consentChoices({ ...base, version: "old" }));
  assert.throws(() => consentChoices({ ...base, terms: false }));
  assert.throws(() =>
    consentChoices({ ...base, sales: true, email: "invalid" }),
  );
  const c = consentChoices({ ...base, email: "unused@example.test" });
  assert.equal(c.email, "");
  assert.equal(c.sales, false);
  assert.equal(c.improvement, false);
  assert.equal(
    consentChoices({ ...base, sales: true, email: "founder@example.test" })
      .email,
    "founder@example.test",
  );
});
test("shared content optional use requires unanimous purpose-specific permission, never empty or withdrawn consent", () => {
  const yes = consentChoices({
      ...base,
      sales: true,
      email: "founder@example.test",
    }),
    no = consentChoices(base);
  assert.equal(sharedUseAllowed([], "sales"), false);
  assert.equal(sharedUseAllowed([yes, no], "sales"), false);
  assert.equal(sharedUseAllowed([yes], "sales"), true);
  assert.equal(sharedUseAllowed([yes], "improvement"), false);
  assert.equal(sharedUseAllowed([{ ...yes, withdrawn: true }], "sales"), false);
});
