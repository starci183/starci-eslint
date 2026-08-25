/**
 * The executable boundary between product components and `@starci/grammar`.
 *
 * Grammar describes a tree and branch adapters render it. Product blocks compose those typed
 * pieces; they do not import Core values, smuggle pre-built JSX through ReactNode slots, or open a
 * second runtime lane beside ComponentType. These rules keep that boundary mechanical.
 */

const normalizePath = (value) => String(value || "").replace(/\\/g, "/")

const SURFACES = new Set(["SurfaceCard", "SurfaceFormCard", "SurfaceListCard", "HighlightCard"])
const TYPED_ROOTS = new Set([...SURFACES, "Tree"])

const filenameOf = (context) => normalizePath(context.filename || context.getFilename())
const isTestFile = (filename) => /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec))\.[^/]+$/.test(filename)
const isBranchOwner = (filename) => filename.includes("/src/components/branches/")
const isGrammarContract = (filename) => /\/src\/components\/contracts\/grammar\.[^/]+$/.test(filename)
const isProductSource = (filename) => filename.includes("/src/") && !isTestFile(filename)

const jsxName = (node) => node?.name?.type === "JSXIdentifier" ? node.name.name : null

const attribute = (node, name) =>
  (node.attributes || []).find(
    (entry) => entry.type === "JSXAttribute" && entry.name?.type === "JSXIdentifier" && entry.name.name === name,
  )

const expressionOf = (attributeNode) => {
  const value = attributeNode?.value
  if (!value) return null
  return value.type === "JSXExpressionContainer" ? value.expression : value
}

const unwrapExpression = (node) => {
  let current = node
  while (["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "ChainExpression"].includes(current?.type)) {
    current = current.expression
  }
  return current
}

const literalString = (node) => {
  const value = unwrapExpression(node)
  if (value?.type === "Literal" && typeof value.value === "string") return value.value
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0) return value.quasis[0]?.value?.cooked ?? null
  return null
}

const defineContractCall = (node) => {
  const value = unwrapExpression(node)
  return value?.type === "CallExpression" && value.callee?.type === "Identifier" && value.callee.name === "defineContractComponent"
    ? value
    : null
}

const meaningfulChildren = (openingElement) => {
  const children = openingElement.parent?.children || []
  return children.filter((child) => {
    if (child.type === "JSXText") return child.value.trim().length > 0
    if (child.type === "JSXExpressionContainer") return child.expression?.type !== "JSXEmptyExpression"
    return true
  })
}

// -- GRAMMAR-1 -----------------------------------------------------------------------------------

/** Product source consumes adapters; only adapter/contract owners may import Core grammar values. */
export const noCoreGrammarValueImportOutsideAdapter = {
  meta: {
    type: "problem",
    docs: { description: "Core grammar values are imported only by branch adapters and the grammar contract owner." },
    schema: [],
    messages: {
      boundary:
        "`{{source}}` is the Core grammar value lane. Product source must consume a typed branch/composition adapter; only components/branches and components/contracts/grammar may import these values.",
    },
  },
  create(context) {
    const filename = filenameOf(context)
    if (!isProductSource(filename) || isBranchOwner(filename) || isGrammarContract(filename)) return {}
    return {
      ImportDeclaration(node) {
        const source = String(node.source?.value || "")
        if (!/^@starci\/grammar(?:\/|$)/.test(source)) return
        const valueSpecifiers = (node.specifiers || []).filter(
          (specifier) => node.importKind !== "type" && specifier.importKind !== "type",
        )
        if (valueSpecifiers.length > 0) context.report({ node, messageId: "boundary", data: { source } })
      },
    }
  },
}

// -- GRAMMAR-2 -----------------------------------------------------------------------------------

/** Surface branches are invoked through their contract/render lane, never as JSX containers. */
export const surfaceBranchRequiresContractRender = {
  meta: {
    type: "problem",
    docs: { description: "A surface branch requires contract + render and accepts no JSX children." },
    schema: [],
    messages: {
      lane: "`{{component}}` is a grammar branch. Pass both `contract` and `render`; do not use a raw surface prop lane.",
      children:
        "`{{component}}` received pre-built JSX children. Describe the branch with `contract` + `render` so Tree can validate and own the composition.",
    },
  },
  create(context) {
    const filename = filenameOf(context)
    if (!isProductSource(filename) || isBranchOwner(filename)) return {}
    return {
      JSXOpeningElement(node) {
        const component = jsxName(node)
        if (!component || !SURFACES.has(component)) return
        if (!attribute(node, "contract") || !attribute(node, "render")) {
          context.report({ node, messageId: "lane", data: { component } })
        }
        for (const child of meaningfulChildren(node)) {
          context.report({ node: child, messageId: "children", data: { component } })
        }
      },
    }
  },
}

// -- GRAMMAR-3 -----------------------------------------------------------------------------------

const propertyName = (node) => {
  if (node?.key?.type === "Identifier") return node.key.name
  if (node?.key?.type === "Literal" && typeof node.key.value === "string") return node.key.value
  return "slot"
}

const forbiddenReactType = (node, seen = new Set()) => {
  if (!node || typeof node !== "object" || seen.has(node)) return null
  seen.add(node)
  if (node.type === "TSTypeReference") {
    const name = node.typeName?.type === "Identifier" ? node.typeName.name : null
    if (name === "ReactNode" || name === "ReactElement") return name
  }
  if (
    node.type === "TSQualifiedName" &&
    node.left?.type === "Identifier" && node.left.name === "JSX" &&
    node.right?.type === "Identifier" && node.right.name === "Element"
  ) return "JSX.Element"
  if (
    node.type === "TSQualifiedName" &&
    node.left?.type === "Identifier" && node.left.name === "React" &&
    node.right?.type === "Identifier" && ["ReactNode", "ReactElement"].includes(node.right.name)
  ) return `React.${node.right.name}`
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "tokens" || key === "comments") continue
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = forbiddenReactType(entry, seen)
        if (found) return found
      }
    } else {
      const found = forbiddenReactType(value, seen)
      if (found) return found
    }
  }
  return null
}

/** Component APIs cannot carry already-rendered React values across the grammar boundary. */
export const noReactnodeEscapeSlot = {
  meta: {
    type: "problem",
    docs: { description: "Product component slots carry typed data/components, never ReactNode or JSX.Element." },
    schema: [],
    messages: {
      escape:
        "`{{slot}}` exposes `{{type}}`, an already-built rendering escape hatch. Pass typed data or a ComponentType through the canonical contract/render lane instead.",
    },
  },
  create(context) {
    const filename = filenameOf(context)
    if (!isProductSource(filename) || isBranchOwner(filename) || isGrammarContract(filename)) return {}
    return {
      TSPropertySignature(node) {
        const type = forbiddenReactType(node.typeAnnotation?.typeAnnotation)
        if (type) context.report({ node, messageId: "escape", data: { slot: propertyName(node), type } })
      },
    }
  },
}

const collectDefinitions = () => {
  const definitions = new Map()
  return {
    definitions,
    visitor: {
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier" && node.init) definitions.set(node.id.name, unwrapExpression(node.init))
      },
    },
  }
}

const resolvedDefineCall = (expression, definitions) => {
  const direct = defineContractCall(expression)
  if (direct) return direct
  const value = unwrapExpression(expression)
  return value?.type === "Identifier" ? defineContractCall(definitions.get(value.name)) : null
}

// -- GRAMMAR-4 -----------------------------------------------------------------------------------

/** Runtime props require the ComponentType lane of defineContractComponent. */
export const runtimeContractContentRequiresComponentType = {
  meta: {
    type: "problem",
    docs: { description: "A surface with runtime props renders a named ComponentType contract." },
    schema: [],
    messages: {
      component:
        "This runtime surface binds content instead of a ComponentType. Define a named render component and pass it as the second argument to `defineContractComponent` before sending runtime `props`.",
    },
  },
  create(context) {
    const filename = filenameOf(context)
    if (!isProductSource(filename) || isBranchOwner(filename)) return {}
    const { definitions, visitor } = collectDefinitions()
    const candidates = []
    return {
      ...visitor,
      JSXOpeningElement(node) {
        const component = jsxName(node)
        if (!component || !SURFACES.has(component)) return
        const runtimeInput = component === "SurfaceListCard"
          ? attribute(node, "props")
          : attribute(node, "contentProps")
        if (!runtimeInput) return
        candidates.push({ node, render: expressionOf(attribute(node, "render")) })
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          const call = resolvedDefineCall(candidate.render, definitions)
          if (!call) continue // an imported, already-typed contract is checked by TypeScript
          const content = unwrapExpression(call.arguments[1])
          if (content?.type !== "Identifier") context.report({ node: candidate.node, messageId: "component" })
        }
      },
    }
  },
}

// -- GRAMMAR-5 -----------------------------------------------------------------------------------

/** A rendered contract cannot claim a different identity from its Tree/surface host. */
export const treeContractRenderIdentity = {
  meta: {
    type: "problem",
    docs: { description: "Tree/surface contract identity matches defineContractComponent identity." },
    schema: [],
    messages: {
      mismatch:
        "Host contract `{{host}}` does not match render contract `{{render}}`. One branch has one identity; use the same key in Tree/surface and defineContractComponent.",
    },
  },
  create(context) {
    const filename = filenameOf(context)
    if (!isProductSource(filename)) return {}
    const { definitions, visitor } = collectDefinitions()
    const candidates = []
    return {
      ...visitor,
      JSXOpeningElement(node) {
        const component = jsxName(node)
        if (!component || !TYPED_ROOTS.has(component)) return
        const host = literalString(expressionOf(attribute(node, "contract")))
        const render = expressionOf(attribute(node, "render"))
        if (host && render) candidates.push({ node, host, render })
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          const call = resolvedDefineCall(candidate.render, definitions)
          const render = literalString(call?.arguments?.[0])
          if (render && render !== candidate.host) {
            context.report({ node: candidate.node, messageId: "mismatch", data: { host: candidate.host, render } })
          }
        }
      },
    }
  },
}

// -- GRAMMAR-6 -----------------------------------------------------------------------------------

const exportedFunction = (node) => {
  if (node.type === "FunctionDeclaration") return node.parent?.type === "ExportNamedDeclaration" || node.parent?.type === "ExportDefaultDeclaration"
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return false
  const declarator = node.parent
  return declarator?.type === "VariableDeclarator" && declarator.parent?.parent?.type === "ExportNamedDeclaration"
}

const returnedValues = (node) => {
  if (node.body?.type !== "BlockStatement") return [node.body]
  return node.body.body.filter((statement) => statement.type === "ReturnStatement").map((statement) => statement.argument)
}

const untypedRoot = (node) => {
  const value = unwrapExpression(node)
  if (!value || value.type === "Literal" && value.value === null) return null
  if (value.type === "ConditionalExpression") return untypedRoot(value.consequent) || untypedRoot(value.alternate)
  if (value.type === "LogicalExpression") return untypedRoot(value.right)
  if (value.type === "JSXFragment") return value
  if (value.type !== "JSXElement") return null
  const name = value.openingElement?.name
  if (name?.type === "JSXIdentifier" && /^[A-Z]/.test(name.name)) return null
  if (name?.type === "JSXMemberExpression") return null
  return value
}

/** Exported block roots are typed compositions, not fragments or structural host elements. */
export const blockRootIsTypedComposition = {
  meta: {
    type: "problem",
    docs: { description: "An exported block starts at a typed composition boundary." },
    schema: [],
    messages: {
      root:
        "A block cannot own an anonymous fragment or structural host root. Start it with Tree or a named typed composition component whose contract owns the arrangement.",
    },
  },
  create(context) {
    const filename = filenameOf(context)
    if (!isProductSource(filename) || !filename.includes("/components/blocks/")) return {}
    const check = (node) => {
      if (!exportedFunction(node)) return
      for (const value of returnedValues(node)) {
        const root = untypedRoot(value)
        if (root) context.report({ node: root, messageId: "root" })
      }
    }
    return {
      ArrowFunctionExpression: check,
      FunctionExpression: check,
      FunctionDeclaration: check,
    }
  },
}

export const rules = {
  "no-core-grammar-value-import-outside-adapter": noCoreGrammarValueImportOutsideAdapter,
  "surface-branch-requires-contract-render": surfaceBranchRequiresContractRender,
  "no-reactnode-escape-slot": noReactnodeEscapeSlot,
  "runtime-contract-content-requires-component-type": runtimeContractContentRequiresComponentType,
  "tree-contract-render-identity": treeContractRenderIdentity,
  "block-root-is-typed-composition": blockRootIsTypedComposition,
}

export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))

const severityOf = (setting) => {
  const severity = Array.isArray(setting) ? setting[0] : setting
  if (severity === "error") return 2
  if (severity === "warn") return 1
  if (severity === "off") return 0
  return severity
}

/** Prove every newly created production probe receives every grammar-boundary rule strictly. */
export const auditEffectiveConfigCoversNewFiles = (probes, expectedRules = Object.keys(rules).map((name) => `starci-fe/${name}`)) => {
  const uncovered = []
  for (const probe of probes || []) {
    const config = probe?.config ?? {}
    const missing = expectedRules.filter((name) => severityOf(config.rules?.[name]) !== 2)
    if (missing.length > 0 || config.linterOptions?.noInlineConfig !== true) {
      uncovered.push({ path: probe?.path ?? "<unknown>", missing, refusesInlineConfig: config.linterOptions?.noInlineConfig === true })
    }
  }
  return { ok: (probes || []).length > 0 && uncovered.length === 0, uncovered }
}

const versionParts = (value) => {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

/** Canon FE V2 is compatible only with the ComponentType/Tree grammar lane introduced in 0.2.0. */
export const auditGrammarEslintVersionParity = ({ eslintVersion, grammarVersion } = {}) => {
  const eslint = versionParts(eslintVersion)
  const grammar = versionParts(grammarVersion)
  const ok = Boolean(eslint && grammar && eslint[0] === 2 && (grammar[0] > 0 || grammar[1] >= 2))
  return { ok, eslintVersion: eslintVersion ?? null, grammarVersion: grammarVersion ?? null, expected: "canon 2.x + grammar >=0.2.0" }
}

/** README headline counts are executable release metadata, not hand-kept prose. */
export const auditRuleReadmeCountParity = ({ readme, publishedRules = rules, publishedLaws } = {}) => {
  const match = String(readme || "").match(/\*\*(\d+) ESLint rules, from (\d+) laws/)
  const actualRules = Object.keys(publishedRules || {}).length
  const actualLaws = Number(publishedLaws)
  const declaredRules = match ? Number(match[1]) : null
  const declaredLaws = match ? Number(match[2]) : null
  return {
    ok: declaredRules === actualRules && declaredLaws === actualLaws,
    declaredRules,
    actualRules,
    declaredLaws,
    actualLaws,
  }
}

/** A local Python MCP/Qdrant result is usable only when it proves one clean reference worktree. */
export const auditReferenceReceiptPreflight = ({ reference, receipt } = {}) => {
  const sourcePath = normalizePath(reference?.path)
  const indexedPath = normalizePath(receipt?.sourcePath)
  const commit = String(reference?.revision || "")
  const revision = String(receipt?.revision || "")
  const revisionMatches = revision.length >= 7 && commit.startsWith(revision)
  const referenceRoot = sourcePath.includes("/.worktrees/references/")
  const sourcePathMatches = referenceRoot && sourcePath === indexedPath
  const clean = receipt?.dirty === false
  const hasGeneration = typeof receipt?.generation === "string" && receipt.generation.length > 0
  return {
    ok: revisionMatches && sourcePathMatches && clean && hasGeneration,
    revisionMatches,
    referenceRoot,
    sourcePathMatches,
    clean,
    hasGeneration,
  }
}

export const audits = {
  "effective-config-covers-new-files": auditEffectiveConfigCoversNewFiles,
  "grammar-eslint-version-parity": auditGrammarEslintVersionParity,
  "rule-readme-count-parity": auditRuleReadmeCountParity,
  "reference-receipt-preflight": auditReferenceReceiptPreflight,
}
