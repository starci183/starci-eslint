import assert from "node:assert/strict"
import test from "node:test"
import { rules, recommended } from "./vendor-boundary.mjs"

test("vendor boundary publishes only ordinary ownership rules", () => {
  assert.deepEqual(Object.keys(rules).sort(), [
    "no-internal-starci-href",
    "no-direct-heroicon-import",
    "vendor-primitive-has-named-owner",
  ].sort())
  assert.deepEqual(Object.keys(recommended).sort(), Object.keys(rules).map((name) => `starci-fe/${name}`).sort())
})
