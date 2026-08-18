/**
 * Twin tests for the type-safety rules.
 *
 *   node --test type-safety.test.mjs
 *
 * `no-double-cast` is the one with a real trap in it: a single `as unknown` is legitimate (widening
 * on the way OUT of a value is honest), and only the pair that lands back on a concrete type is the
 * overrule. A rule that fired on either cast alone would flag correct code constantly.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import {
  noConstEnum,
  noDoubleCast,
  noInlineParamType,
  noLineSuppression,
  noUnguardedUnknownCast,
  rules,
} from "./type-safety.mjs"

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
  // the other rules this law publishes are registered (not enabled) so a disable comment naming
  // one of them resolves to a real rule instead of tripping ESLint's own "rule not found" check --
  // a concern of the test harness, not of `no-line-suppression` itself
  plugins: { "starci-be": { rules } },
})

const SRC = "D:/repo/src/modules/bussiness/user/user.service.ts"
const SPEC = "D:/repo/src/modules/bussiness/user/user.service.spec.ts"
const TESTS = "D:/repo/src/tests/helpers/create-e2e-app.ts"

test("every rule this law declares is exported under its published name", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
  }
})

test("TYPE-2: the double cast is refused in product code and allowed in the test lanes", () => {
  tester.run("no-double-cast", noDoubleCast, {
    valid: [
      // widening on the way out is honest
      { filename: SRC, code: "const raw = value as unknown" },
      // a single narrowing cast is not this rule's business
      { filename: SRC, code: "const row = raw as EnrollmentEntity" },
      // a cast pair that does not go through `unknown`
      { filename: SRC, code: "const n = (x as number) as 1" },
      // building a deliberately wrong value is how a spec proves an API refuses it
      { filename: SPEC, code: "const bad = {} as unknown as EnrollmentEntity" },
      { filename: TESTS, code: "const bad = {} as unknown as EntityManager" },
    ],
    invalid: [
      {
        filename: SRC,
        code: "const row = raw as unknown as EnrollmentEntity",
        errors: [{ messageId: "doubleCast" }],
      },
    ],
  })
})

test("TYPE-3: a destructured parameter takes a named type", () => {
  tester.run("no-inline-param-type", noInlineParamType, {
    valid: [
      "export const grantXp = ({ userId, amount }: GrantXpParams) => null",
      // a positional parameter with an inline type is a different (smaller) problem
      "export const grantXp = (params: { userId: string }) => null",
      // no annotation at all is the compiler's business, not this rule's
      "export const grantXp = ({ userId }) => null",
    ],
    invalid: [
      {
        code: "export const grantXp = ({ userId, amount }: { userId: string, amount: number }) => null",
        errors: [{ messageId: "inline" }],
      },
      {
        code: "function grantXp({ userId }: { userId: string }) { return userId }",
        errors: [{ messageId: "inline" }],
      },
    ],
  })
})

test("TYPE-4: an enum keeps its runtime object", () => {
  tester.run("no-const-enum", noConstEnum, {
    valid: [
      "export enum Verdict { Pass, Fail }",
      "declare enum Ambient { A }",
    ],
    invalid: [
      { code: "export const enum Verdict { Pass, Fail }", errors: [{ messageId: "constEnum" }] },
    ],
  })
})

test("TYPE-1 (law 2): a value declared unknown is narrowed before it is cast", () => {
  tester.run("no-unguarded-unknown-cast", noUnguardedUnknownCast, {
    valid: [
      // typeof + null check narrows before the cast -- the anchor's own pattern
      `const extractStatus = (error: unknown) => {
        if (typeof error !== "object" || error === null) {
          return undefined
        }
        return error as Record<string, unknown>
      }`,
      // instanceof narrows before the cast
      `const parse = (value: unknown) => {
        if (value instanceof Error) {
          return value as Error
        }
        return null
      }`,
      // Array.isArray narrows before the cast
      `const parse = (value: unknown) => {
        if (Array.isArray(value)) {
          return value as Array<string>
        }
        return []
      }`,
      // a custom predicate call is the "predicate" form of narrowing the law names, even though
      // this rule cannot read what is inside it
      `const resolve = (current: unknown) => {
        if (!this.isPlainObject(current)) {
          return undefined
        }
        return current as Record<string, unknown>
      }`,
      // widening TO unknown is honest and out of this rule's scope
      "const widen = (value: unknown) => value as unknown",
      // the cast target is never declared unknown, so it is not tracked by this rule at all
      "const row = raw as EnrollmentEntity",
      // the harness lane hands back whatever came off the bus as the caller's own generic type,
      // deliberately -- the same lane TYPE-2 already carves out
      {
        filename: TESTS,
        code: `export const nextMessage = <TPayload,>(payload: unknown) => {
          return payload as TPayload
        }`,
      },
    ],
    invalid: [
      {
        filename: SRC,
        code: `const parseError = (error: unknown) => {
          return error as Record<string, unknown>
        }`,
        errors: [{ messageId: "unguarded" }],
      },
      {
        // the guard exists, but it checks a DIFFERENT identifier than the one being cast
        filename: SRC,
        code: `const parseError = (error: unknown, flag: boolean) => {
          if (flag) {
            return null
          }
          return error as Record<string, unknown>
        }`,
        errors: [{ messageId: "unguarded" }],
      },
    ],
  })
})

// TYPE-5 (law 6) has no rule here on purpose. A candidate was written, then measured against the
// reference backend as this canon's own standard requires, and both of its real firings turned
// out to be independent facts on transport/seed DTOs (GlobalSearchItem, AdvertisementSeedItem) --
// not a product of states. See the comment in type-safety.mjs where TYPE-5 would sit.

test("TYPE-6 (law 7): a per-line suppression of a type-safety rule is never the lane speaking", () => {
  tester.run("no-line-suppression", noLineSuppression, {
    valid: [
      // no suppression comment at all
      "const row = raw as EnrollmentEntity",
      // a disable for a rule outside this family is not this rule's business
      "// eslint-disable-next-line no-console\nconsole.log(1)",
    ],
    invalid: [
      {
        code: "// eslint-disable-next-line starci-be/no-double-cast\nconst row = raw as unknown as EnrollmentEntity",
        errors: [{ messageId: "suppression" }],
      },
      {
        code: "/* eslint-disable starci-be/no-const-enum */\nexport const enum Verdict { Pass, Fail }",
        errors: [{ messageId: "suppression" }],
      },
    ],
  })
})
