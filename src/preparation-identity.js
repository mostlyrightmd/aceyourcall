import { createHash } from "node:crypto";
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export function preparationIdentity(context) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        2,
        context.application.replace(/\r\n/g, "\n").trim(),
        canonical(context.facts || {}),
      ]),
    )
    .digest("hex");
}
export function legacyPreparationIdentity(roomId, context) {
  return createHash("sha256")
    .update(JSON.stringify([1, roomId, context.application, context.facts]))
    .digest("hex");
}
