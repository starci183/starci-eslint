import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import {
  audits,
  blockRootIsTypedComposition,
  noCoreGrammarValueImportOutsideAdapter,
  noReactnodeEscapeSlot,
  rules,
  runtimeContractContentRequiresComponentType,
  surfaceBranchRequiresContractRender,
  treeContractRenderIdentity,
} from "./grammar-boundary.mjs"

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const product = "/repo/apps/app/src/components/blocks/agentos/component.tsx"
const branch = "/repo/packages/ui/src/components/branches/SurfaceCard/index.tsx"

test("every grammar-boundary rule and audit is published", () => {
  assert.equal(Object.keys(rules).length, 6)
  assert.deepEqual(Object.keys(audits).sort(), [
    "effective-config-covers-new-files",
    "grammar-eslint-version-parity",
    "reference-receipt-preflight",
    "rule-readme-count-parity",
  ])
})

test("GRAMMAR-1: only adapters import Core grammar values", () => {
  tester.run("no-core-grammar-value-import-outside-adapter", noCoreGrammarValueImportOutsideAdapter, {
    valid: [
      { filename: branch, code: 'import { SurfaceCard } from "@starci/grammar/core"' },
      { filename: product, code: 'import type { ContractTree } from "@starci/grammar/core"' },
      { filename: product, code: 'import { SurfaceCard } from "@nivo/ui"' },
    ],
    invalid: [{ filename: product, code: 'import { SurfaceCard } from "@starci/grammar/core"', errors: [{ messageId: "boundary" }] }],
  })
})

test("GRAMMAR-2: a surface has one typed contract/render lane", () => {
  tester.run("surface-branch-requires-contract-render", surfaceBranchRequiresContractRender, {
    valid: [{ filename: product, code: 'const x = <SurfaceCard contract="agent.setup" render={Setup} />' }],
    invalid: [
      { filename: product, code: "const x = <SurfaceCard label=\"Setup\"><section /></SurfaceCard>", errors: [{ messageId: "lane" }, { messageId: "children" }] },
    ],
  })
})

test("GRAMMAR-3: product slots cannot escape through ReactNode", () => {
  tester.run("no-reactnode-escape-slot", noReactnodeEscapeSlot, {
    valid: [
      { filename: product, code: "type P = { readonly rows: ReadonlyArray<string> }" },
      { filename: branch, code: "type P = { readonly projection: React.ReactNode }" },
    ],
    invalid: [
      { filename: product, code: "type P = { readonly content: React.ReactNode }", errors: [{ messageId: "escape" }] },
      { filename: product, code: "type P = { readonly rail: JSX.Element }", errors: [{ messageId: "escape" }] },
    ],
  })
})

test("GRAMMAR-4: runtime data selects the ComponentType lane", () => {
  tester.run("runtime-contract-content-requires-component-type", runtimeContractContentRequiresComponentType, {
    valid: [
      { filename: product, code: 'const View = () => null; const R = defineContractComponent("agent.setup", View); const x = <SurfaceCard contract="agent.setup" render={R} contentProps={{ messages }} />' },
      { filename: product, code: 'const R = defineContractComponent("agent.setup", { body: null }); const x = <SurfaceCard contract="agent.setup" render={R} props={{ label: "Setup" }} />' },
    ],
    invalid: [{ filename: product, code: 'const R = defineContractComponent("agent.setup", { body: null }); const x = <SurfaceCard contract="agent.setup" render={R} contentProps={{ messages }} />', errors: [{ messageId: "component" }] }],
  })
})

test("GRAMMAR-5: Tree and render share one contract identity", () => {
  tester.run("tree-contract-render-identity", treeContractRenderIdentity, {
    valid: [{ filename: product, code: 'const R = defineContractComponent("agent.setup", View); const x = <Tree contract="agent.setup" render={R} />' }],
    invalid: [{ filename: product, code: 'const R = defineContractComponent("agent.execute", View); const x = <Tree contract="agent.setup" render={R} />', errors: [{ messageId: "mismatch" }] }],
  })
})

test("GRAMMAR-6: a block begins at a typed composition root", () => {
  tester.run("block-root-is-typed-composition", blockRootIsTypedComposition, {
    valid: [{ filename: product, code: "export const SetupBlock = () => <Tree />" }],
    invalid: [
      { filename: product, code: "export const SetupBlock = () => <><Panel /></>", errors: [{ messageId: "root" }] },
      { filename: product, code: "export const SetupBlock = () => <section />", errors: [{ messageId: "root" }] },
    ],
  })
})

test("audits prove coverage, package parity, README parity and immutable Qdrant receipts", () => {
  const strict = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
  assert.equal(audits["effective-config-covers-new-files"]([
    { path: product, config: { rules: strict, linterOptions: { noInlineConfig: true } } },
  ]).ok, true)
  assert.equal(audits["grammar-eslint-version-parity"]({ eslintVersion: "2.0.0", grammarVersion: "0.2.0" }).ok, true)
  assert.equal(audits["rule-readme-count-parity"]({ readme: "**6 ESLint rules, from 1 laws", publishedRules: rules, publishedLaws: 1 }).ok, true)

  const reference = { path: "D:/source/.worktrees/references/starci-academy-fe", revision: "acc7e2656228f53cc63c9bca3b079ee869e5d940" }
  assert.equal(audits["reference-receipt-preflight"]({
    reference,
    receipt: { sourcePath: reference.path, revision: "acc7e2656228", dirty: false, generation: "generation-1" },
  }).ok, true)
  assert.equal(audits["reference-receipt-preflight"]({
    reference,
    receipt: { sourcePath: "D:/source", revision: "9443a2d7721f", dirty: true, generation: "stale" },
  }).ok, false)
})
