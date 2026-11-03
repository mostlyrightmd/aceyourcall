export const POLICY_VERSION = "2026-11-01";
export function consentChoices(input) {
  if (input?.version !== POLICY_VERSION || input?.terms !== true)
    throw Error(
      "Please review and accept the current Terms before continuing.",
    );
  if (
    typeof input.improvement !== "boolean" ||
    typeof input.sales !== "boolean"
  )
    throw Error("Choose your optional data permissions.");
  const email = String(input.email || "").trim();
  if (
    email.length > 254 ||
    (input.sales && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw Error(
      "Enter a contact email for the optional Mostly Right follow-up.",
    );
  return {
    version: POLICY_VERSION,
    terms: true,
    improvement: input.improvement,
    sales: input.sales,
    email: input.sales ? email : "",
    at: Date.now(),
    withdrawn: false,
  };
}
export function sharedUseAllowed(consents, purpose) {
  return (
    ["sales", "improvement"].includes(purpose) &&
    consents.length > 0 &&
    consents.every(
      (c) =>
        !c.withdrawn && c[purpose] === true && c.version === POLICY_VERSION,
    )
  );
}
