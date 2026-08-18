/**
 * Twin tests for the props-and-slots rule.
 *
 *   node --test props-and-slots.test.mjs
 *
 * The valid cases carry the weight here. This rule fires on ONE shape - an object pattern with an
 * inline type - and a version that widened to "any parameter with a type" would fire on every
 * ordinary function in the tree, which is how a rule earns a blanket disable comment.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import {
  noChildrenSlot,
  noCssDoorTypeLaundering,
  noPerPartClassNameProp,
  noPublicClassNameProp,
  noPublicFrameCssProps,
  noInlineParameterType,
  noSurfaceListItemsSlot,
  rules,
} from "./props-and-slots.mjs"

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

test("every rule this law declares is exported under its published name", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
  }
})

test("SLOTS-3: a parameter's complete shape is named in the module", () => {
  tester.run("no-inline-parameter-type", noInlineParameterType, {
    valid: [
      "export const Row = ({ props }: RowProps) => null",
      "export const Row = ({ props }: LeafProps<RowData>) => null",
      // untyped destructuring is a different question, and not this rule's
      "const f = ({ a }) => a",
      // a named scalar parameter is not a shape with nowhere to be read from
      "const f = (value: string) => value",
      "const f = (input: RowProps) => input.props",
    ],
    invalid: [
      {
        code: "export const Row = ({ props }: { props: { label: string } }) => null",
        errors: [{ messageId: "inline" }],
      },
      {
        code: "const f = function ({ a }: { a: string }) { return a }",
        errors: [{ messageId: "inline" }],
      },
      {
        // parentheses do not hide it
        code: "const f = ({ a }: ({ a: string })) => a",
        errors: [{ messageId: "inline" }],
      },
      {
        code: "const C = (input: DashboardFrame & { readonly signOutLabel: string }) => input",
        errors: [{ messageId: "inline" }],
      },
      {
        code: "const C = ({ props }: DashboardFrame & { readonly props: Copy }) => props",
        errors: [{ messageId: "inline" }],
      },
      {
        code: "const f = (input: { a: string }) => input.a",
        errors: [{ messageId: "inline" }],
      },
    ],
  })
})

const BRANCH = "/repo/src/components/branches/SurfaceCard/index.tsx"
const MODAL_BRANCH = "/repo/src/components/branches/ModalBranch/index.tsx"
const LEGACY_SHELL = "/repo/src/components/shells/ModalShell/index.tsx"

test("SLOTS-4: every component container takes contract and render, never children", () => {
  tester.run("no-children-slot", noChildrenSlot, {
    valid: [
      // the shape this rule exists to push people towards
      { filename: BRANCH, code: "export interface P { contract: ContractKey; render: ChildrenOf<K> }" },
      { filename: BRANCH, code: "export const S = ({ props, render }: SProps) => null" },
      { filename: MODAL_BRANCH, code: "export interface P { contract: ContractKey; render: ChildrenOf<K> }" },
      { filename: MODAL_BRANCH, code: "export const M = ({ contract, render }: ModalBranchProps) => null" },
      // outside the component tree entirely - a page or a test may say what it likes
      { filename: "/repo/src/app/page.tsx", code: "export const P = ({ children }: PProps) => null" },
      // an ordinary object property that happens to be called children is not a slot
      { filename: BRANCH, code: "const spec = { children: [] }" },
    ],
    invalid: [
      {
        filename: LEGACY_SHELL,
        code: "type ModalShellProps = { readonly children?: ReactNode }",
        errors: [{ messageId: "slot" }],
      },
      {
        filename: BRANCH,
        code: "export interface SProps { children?: ReactNode }",
        errors: [{ messageId: "slot" }],
      },
      {
        filename: BRANCH,
        code: "export const S = ({ props, children }: SProps) => null",
        errors: [{ messageId: "slot" }],
      },
      {
        // a leaf is below the container tier, so it may not grow one either
        filename: "/repo/src/components/leaves/Icon/index.tsx",
        code: "export const Icon = ({ children }: IconProps) => null",
        errors: [{ messageId: "slot" }],
      },
    ],
  })
})

test("SLOTS-7: list collections travel through named props, never an items lane", () => {
  tester.run("no-surface-list-items-slot", noSurfaceListItemsSlot, {
    valid: [
      {
        filename: "/repo/src/components/blocks/dashboard/DailyQuest/component.tsx",
        code: "import { SurfaceListCard } from '@/components/branches/SurfaceListCard'; export const C = () => <SurfaceListCard contract='daily-quest-list' render={Content} props={{ label, tasks }} />",
      },
    ],
    invalid: [
      {
        filename: "/repo/src/components/blocks/dashboard/DailyQuest/component.tsx",
        code: "import { SurfaceListCard as List } from '@/components/branches/SurfaceListCard'; export const C = () => <List contract='daily-quest-list' render={Content} props={{ label }} items={tasks} />",
        errors: [{ messageId: "items" }],
      },
    ],
  })
})

test("SLOTS-4: framework layouts close ReactNode before the component tier", () => {
  tester.run("no-children-slot", rules["no-children-slot"], {
    valid: [
      {
        filename: "/repo/src/app/dashboard/layout.tsx",
        code: "export const Layout = ({ children }: LayoutProps) => { const surface = defineLeafComponent('page', {}, () => children); return <DashboardFrame surface={surface} /> }",
      },
    ],
    invalid: [
      {
        // A connected layout is NOT the seam, however close it sits to one.
        filename: "/repo/src/components/layouts/LearnShellLayout/index.tsx",
        code: "export const L = ({ children }) => <div>{children}</div>",
        errors: 1,
      },
    ],
  })
})

test("SLOTS-4: a boundary-converter shell inside the component tier is exempt by shape, not by name", () => {
  const ROUTE_SHELL = "/repo/src/components/route/RouteShell/index.tsx"
  tester.run("no-children-slot", rules["no-children-slot"], {
    valid: [
      {
        // RouteShell's ENTIRE job: close a routed page's children into a component
        // reference (useCallback, so it survives the client/server boundary as a
        // function rather than an unserialisable inline component) and hand that
        // reference to the one other component it wraps, under a named prop. It
        // cannot name one contract key - it is reused across every route - so this is
        // the exception SLOTS-4's own message already promises, read from shape.
        filename: ROUTE_SHELL,
        code: `
          export interface RouteShellProps<P extends RouteFrameProps> {
            readonly children: ReactNode
            readonly frame: ComponentType<P>
            readonly props: Omit<P, "surface">
          }
          export const RouteShell = (input: RouteShellProps<P>) => {
            const children = input.children
            const Surface = useCallback(() => <>{children}</>, [children])
            const Frame = input.frame
            return <Frame {...(input.props)} surface={Surface} />
          }
        `,
      },
      {
        // The destructured door into the same shape, still nothing but the handoff.
        filename: ROUTE_SHELL,
        code: `
          export const RouteShell = ({ children, frame: Frame }: RouteShellProps) => {
            const Surface = useCallback(() => <>{children}</>, [children])
            return <Frame surface={Surface} />
          }
        `,
      },
    ],
    invalid: [
      {
        // Same handoff, but it also decides something - a real conditional makes this
        // a layout with a children hole, which is exactly what SLOTS-4 exists to catch.
        // Renaming this file to RouteShell would not make it pass: the exemption reads
        // the function body, not the filename.
        filename: ROUTE_SHELL,
        code: `
          export interface RouteShellProps {
            readonly children: ReactNode
          }
          export const RouteShell = (input: RouteShellProps) => {
            const children = input.children
            const Surface = useCallback(() => <>{children}</>, [children])
            if (input.variant === "modal") {
              return <ModalFrame surface={Surface} />
            }
            return <PageFrame surface={Surface} />
          }
        `,
        errors: [{ messageId: "slot" }],
      },
      {
        // Forwards `children` directly, with no closure and no other component to
        // hand it to - a plain children hole, not a boundary conversion.
        filename: ROUTE_SHELL,
        code: "export const Fwd = ({ children }: FwdProps) => <div className='wrap'>{children}</div>",
        errors: [{ messageId: "slot" }],
      },
    ],
  })
})

test("SLOTS-5/6: public CSS doors stay closed at declarations, call sites and utility types", () => {
  tester.run("no-per-part-classname-prop", noPerPartClassNameProp, {
    valid: [{ filename: BRANCH, code: "type P = { tone: 'quiet' | 'loud' }" }],
    invalid: [{ filename: BRANCH, code: "type P = { titleClassName?: string }", errors: [{ messageId: "perPart" }] }],
  })
  tester.run("no-public-classname-prop", noPublicClassNameProp, {
    valid: [{ filename: BRANCH, code: "type P = { tone: 'quiet' | 'loud' }" }],
    invalid: [
      { filename: BRANCH, code: "type P = { className?: string }", errors: [{ messageId: "declaration" }] },
      {
        filename: "/repo/src/components/blocks/X/component.tsx",
        code: "import { SurfaceCard } from '@/components/branches/SurfaceCard'; const X = () => <SurfaceCard className='p-2' />",
        errors: [{ messageId: "usage" }],
      },
    ],
  })
  tester.run("no-public-frame-css-props", noPublicFrameCssProps, {
    valid: [{ filename: "/repo/src/components/leaves/Stack/index.tsx", code: "type P = { gap?: string }" }],
    invalid: [{ filename: BRANCH, code: "type P = { gap?: string }", errors: [{ messageId: "css" }] }],
  })
  tester.run("no-css-door-type-laundering", noCssDoorTypeLaundering, {
    valid: [{ filename: BRANCH, code: "type P = Pick<Base, 'tone'>" }],
    invalid: [{ filename: BRANCH, code: "type P = Omit<Base, 'className'>", errors: [{ messageId: "utility" }] }],
  })
})
