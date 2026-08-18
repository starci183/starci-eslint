/**
 * The rules that hold `props-and-slots.md`.
 *
 * ALMOST ALL OF THIS LAW IS HELD BY A TYPE, not by a rule. The slot aliases in `props.ts` are the
 * fence: a fifth slot does not fail review, it fails to compile, and there is nothing left for a
 * rule to patrol once the shape itself refuses. That is the stronger arrangement and it is why this
 * module is small.
 *
 * What a type cannot see is a shape with no NAME. An inline object type at the parameter satisfies
 * every constraint the alias imposes and is still wrong, because the wrongness is not about which
 * fields exist - it is that nothing else can refer to them. A compiler has no opinion about whether
 * a shape is findable.
 */

import { COMPONENT_ROOTS, isContractTableFile, isInComponentTier, isTestFile } from "./contract.mjs"

/** True when a parameter type contains an anonymous object shape, including inside intersections. */
const isInlineObjectType = (node) => {
  if (!node) return false
  if (node.type === "TSTypeLiteral") return true
  if (node.type === "TSParenthesizedType") return isInlineObjectType(node.typeAnnotation)
  if (node.type === "TSIntersectionType" || node.type === "TSUnionType") {
    return (node.types || []).some(isInlineObjectType)
  }
  return false
}

// -- SLOTS-3 ---------------------------------------------------------------------------------------

/** A parameter's complete shape is named in the module, never assembled at the parameter. */
export const noInlineParameterType = {
  meta: {
    type: "suggestion",
    docs: { description: "A parameter takes one named props type, not an inline or intersected object shape." },
    schema: [],
    messages: {
      inline:
        "This parameter's shape is written inline, so it has no name and nothing can refer to it - not an import, not the twin that tests this file, not somebody looking for what this component accepts. Declare it in the module and name it here. The cost is one line; the difference is between a contract and a signature.",
    },
  },
  create(context) {
    const checkParams = (node) => {
      for (const param of node.params || []) {
        if (!param) continue
        const declared = param.typeAnnotation?.typeAnnotation
        if (!isInlineObjectType(declared)) continue
        context.report({ node: param.typeAnnotation || param, messageId: "inline" })
      }
    }
    return {
      ArrowFunctionExpression: checkParams,
      FunctionExpression: checkParams,
      FunctionDeclaration: checkParams,
      TSEmptyBodyFunctionExpression: checkParams,
    }
  },
}

// -- SLOTS-4 ---------------------------------------------------------------------------------------

/**
 * True for a component file the slot fence governs.
 *
 * TWO EXEMPTIONS AND ONE LAYOUT FIX, all of which this predicate got wrong at once.
 *
 * It read `/src/components/` as a literal, so in a monorepo - where the same tier sits at
 * `packages/ui/src/*` - the rule applied to NOTHING. That repository reported no violations, which
 * looked like compliance and was silence: the fence was not holding anywhere in it.
 *
 * The registry table is exempt because `ContractSpec.children` is not a children hole; it is the
 * NAMED CHILD GRAMMAR that replaces one. Reporting it asks the file that abolished the anonymous
 * slot to stop describing what it admits instead.
 *
 * @param filename - the file being linted.
 */
const isGoverned = (filename) => {
  const path = String(filename || "").replace(/\\/g, "/")
  if (isContractTableFile(path)) return false
  /*
   * The bare `src` root is dropped here, and only here. `COMPONENT_ROOTS` carries it as a
   * catch-all so a reader that walks up from any file still finds the table; used as a FENCE it
   * matches every file under `src/`, which pulls routed pages into a rule about component slots and
   * reports a page for taking children - the one thing a page legitimately does.
   */
  return COMPONENT_ROOTS.filter((root) => root !== "src").some((root) => path.includes(`/${root}/`))
}

/**
 * True when a function's whole body does nothing but turn `children` into a component
 * reference and hand that reference to exactly one other component under a named prop.
 *
 * THIS IS SLOTS-4'S OWN EXCEPTION, READ FROM SHAPE, NOT FROM A NAME. The rule's message
 * already promises it: a framework route layout may receive `ReactNode` outside the
 * component tier, but must close it into a named projection before a component sees it.
 * A shell that crosses `children` over a client/server boundary - wrapping it in
 * `useCallback` so it survives as a function reference rather than an unserialisable
 * inline component - IS that closing act; there is no contract key to name because the
 * shell is deliberately generic across callers. What makes the exception SAFE to keep
 * narrow is that the shape disqualifies itself the moment the body does one more thing:
 * a second return, a conditional, a data read, an element of its own, or a forwarded
 * value that never passes through the closure all fall through to the ordinary report.
 *
 * - Every statement but the last is a `const x = ...` naming either a plain member/param
 *   read (`const Frame = input.frame`) or a `useCallback(...)` call - nothing else.
 * - The last statement is the only `return`, and it returns exactly one JSX element.
 * - That element's attributes only spread or forward existing bindings, and at least one
 *   of them carries the `useCallback` result - the children-derived reference - by name.
 */
const isChildrenBoundaryConverter = (fn) => {
  if (!fn || fn.body?.type !== "BlockStatement") return false
  const statements = fn.body.body
  let closureVar = null
  let returnNode = null

  for (const statement of statements) {
    if (statement.type === "ReturnStatement") {
      if (returnNode) return false // a second return means this does more than one thing
      returnNode = statement.argument
      continue
    }
    if (statement.type !== "VariableDeclaration" || statement.declarations.length !== 1) return false
    const [declarator] = statement.declarations
    const init = declarator.init
    if (declarator.id.type !== "Identifier" || !init) return false
    if (init.type === "MemberExpression" || init.type === "Identifier") continue // a plain prop read
    if (init.type === "CallExpression" && init.callee?.type === "Identifier" && init.callee.name === "useCallback") {
      const callback = init.arguments[0]
      if (!callback || (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")) {
        return false
      }
      closureVar = declarator.id.name
      continue
    }
    return false // any other statement is the component doing something of its own
  }

  if (!closureVar || !returnNode || returnNode.type !== "JSXElement") return false

  let carriesClosure = false
  for (const attribute of returnNode.openingElement.attributes || []) {
    if (attribute.type === "JSXSpreadAttribute") continue
    if (attribute.type !== "JSXAttribute" || !attribute.value) return false
    const raw = attribute.value.type === "JSXExpressionContainer" ? attribute.value.expression : attribute.value
    const value = raw?.type === "TSAsExpression" ? raw.expression : raw
    if (value?.type !== "Identifier") return false
    if (value.name === closureVar) carriesClosure = true
  }
  return carriesClosure
}

/**
 * A container takes `contract` and `render`, never `children`.
 *
 * THE TYPE CANNOT CATCH THIS ONE, which is why it is here. `props.ts` refuses a fourth slot on the
 * aliases it defines, but nothing stops a file declaring its own props shape by hand and putting
 * `children` in it. What the alias makes unrepresentable, a hand-written interface makes ordinary.
 *
 * Vendor mechanics branches still take a named contract/render projection. Framework route
 * layouts sit outside the component tier and close their ReactNode into that projection before it
 * reaches a component.
 *
 * ONE CLOSED EXCEPTION LIVES INSIDE THE COMPONENT TIER: a boundary-converter shell whose
 * whole body matches {@link isChildrenBoundaryConverter}. It is closed by shape, checked
 * against the actual function the props type belongs to, never by filename or export name
 * - so nothing can opt in by being called `RouteShell`, and nothing loses the exemption by
 * being renamed.
 */
export const noChildrenSlot = {
  meta: {
    type: "problem",
    docs: { description: "Every component container takes contract and render, never children." },
    schema: [],
    messages: {
      slot:
        "`children` accepts markup that has already been built, so its shape cannot be checked. Take contract + render instead. A framework route layout may receive ReactNode outside the component tier, but it must close that value into a named contract projection before handing it to a component.",
    },
  },
  create(context) {
    if (!isGoverned(context.filename || context.getFilename())) return {}

    // Deferred to Program:exit so the boundary-converter exemption - which has to look at
    // the whole file to find the function a props type belongs to - can clear a candidate
    // before it is ever reported.
    const candidates = []
    const componentsByPropsType = new Map()

    const enclosingFunction = (node) => {
      for (let current = node.parent; current; current = current.parent) {
        if (["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(current.type)) {
          return current
        }
      }
      return null
    }

    const enclosingTypeName = (node) => {
      for (let current = node.parent; current; current = current.parent) {
        if (current.type === "TSInterfaceDeclaration" || current.type === "TSTypeAliasDeclaration") {
          return current.id?.name || null
        }
      }
      return null
    }

    /** The name of the type a function's single parameter is annotated with, if any. */
    const parameterTypeName = (fn) => {
      const annotation = fn.params?.[0]?.typeAnnotation?.typeAnnotation
      return annotation?.type === "TSTypeReference" && annotation.typeName?.type === "Identifier"
        ? annotation.typeName.name
        : null
    }

    return {
      TSPropertySignature(node) {
        if (node.key && node.key.type === "Identifier" && node.key.name === "children") {
          candidates.push({ node: node.key, typeName: enclosingTypeName(node) })
        }
      },
      Property(node) {
        // a destructured `children` in a parameter, which is the same slot arriving by another door
        if (node.parent && node.parent.type !== "ObjectPattern") return
        if (node.parent.parent && node.parent.parent.type === "VariableDeclarator") return
        if (node.key && node.key.type === "Identifier" && node.key.name === "children") {
          candidates.push({ node: node.key, fn: enclosingFunction(node) })
        }
      },
      ":function"(fn) {
        const typeName = parameterTypeName(fn)
        if (typeName) componentsByPropsType.set(typeName, fn)
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          const fn = candidate.fn || (candidate.typeName && componentsByPropsType.get(candidate.typeName))
          if (fn && isChildrenBoundaryConverter(fn)) continue
          context.report({ node: candidate.node, messageId: "slot" })
        }
      },
    }
  },
}

/** Name of a plain TypeScript property key. */
const propertyName = (node) => {
  const key = node?.key ?? node?.property
  if (!key) return null
  if (key.type === "Identifier") return key.name
  if (key.type === "Literal" && typeof key.value === "string") return key.value
  return null
}

/** Product source inside a supported component root. */
const isComponentSource = (filename) => {
  const path = String(filename || "").replace(/\\/g, "/")
  return COMPONENT_ROOTS.filter((root) => root !== "src").some((root) => path.includes(`/${root}/`))
}

// -- SLOTS-5 · SLOTS-6 ---------------------------------------------------------------------------

/** A caller cannot reach into one named internal part and style it. */
export const noPerPartClassNameProp = {
  meta: {
    type: "problem",
    docs: { description: "No <part>ClassName prop exposes a component's internal nodes." },
    schema: [],
    messages: {
      perPart:
        "`{{prop}}` lets a caller restyle a node it does not own. Replace the CSS door with a named semantic prop, and keep the appearance decision inside the component or its contract.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isTestFile(filename) || !isComponentSource(filename)) return {}
    return {
      TSPropertySignature(node) {
        const name = propertyName(node)
        if (!name || name === "className" || !/^[a-z][A-Za-z0-9]*ClassName$/.test(name)) return
        context.report({ node, messageId: "perPart", data: { prop: name } })
      },
    }
  },
}

/** Public house components never expose className/classNames placement doors. */
export const noPublicClassNameProp = {
  meta: {
    type: "problem",
    docs: { description: "House components own appearance and expose no public className/classNames prop." },
    schema: [],
    messages: {
      declaration:
        "Public component prop `{{prop}}` is a CSS placement door. Expose a semantic variant or a named contract instead.",
      usage:
        "Do not pass `{{prop}}` to house component `{{component}}`; its owner or parent contract decides appearance.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isTestFile(filename)) return {}
    const inComponent = isComponentSource(filename)
    const bindings = new Set()
    return {
      ImportDeclaration(node) {
        const source = String(node.source?.value || "").replace(/\\/g, "/")
        if (!/(?:^|\/)components\//.test(source)) return
        for (const specifier of node.specifiers || []) {
          if (specifier.local?.name) bindings.add(specifier.local.name)
        }
      },
      TSPropertySignature(node) {
        if (!inComponent) return
        const name = propertyName(node)
        if (name === "className" || name === "classNames") {
          context.report({ node, messageId: "declaration", data: { prop: name } })
        }
      },
      JSXOpeningElement(node) {
        const component = node.name?.type === "JSXIdentifier" ? node.name.name : null
        if (!component || !bindings.has(component)) return
        for (const attribute of node.attributes || []) {
          if (attribute.type !== "JSXAttribute") continue
          const prop = attribute.name?.type === "JSXIdentifier" ? attribute.name.name : null
          if (prop === "className" || prop === "classNames") {
            context.report({ node: attribute, messageId: "usage", data: { prop, component } })
          }
        }
      },
    }
  },
}

/** CSS-shaped layout props are not public API above the atomic leaf tier. */
const FRAME_CSS_PROPS = new Set(["gap", "padding", "align", "justify", "className", "classNames", "style", "inline", "nested"])

export const noPublicFrameCssProps = {
  meta: {
    type: "problem",
    docs: { description: "Non-leaf component contracts expose semantic decisions, not CSS-shaped frame props." },
    schema: [],
    messages: {
      css:
        "`{{prop}}` is a public CSS/frame decision above the leaf tier. Move the arrangement into a named contract or expose the semantic state that selects one.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isTestFile(filename) || !isComponentSource(filename) || isInComponentTier(filename, "leaves")) return {}
    return {
      TSPropertySignature(node) {
        const name = propertyName(node)
        if (name && FRAME_CSS_PROPS.has(name)) context.report({ node, messageId: "css", data: { prop: name } })
      },
    }
  },
}

/** String literal keys named by Omit/Pick/Exclude. */
const typeKeys = (node, out = []) => {
  if (!node) return out
  if (node.type === "TSUnionType") {
    for (const member of node.types || []) typeKeys(member, out)
    return out
  }
  if (node.type === "TSLiteralType" && node.literal?.type === "Literal" && typeof node.literal.value === "string") {
    out.push(node.literal.value)
  }
  return out
}

/** Hiding a CSS door with a utility type is not closing the owner that exposed it. */
export const noCssDoorTypeLaundering = {
  meta: {
    type: "problem",
    docs: { description: "Omit/Pick/Exclude cannot hide className/classNames/style doors." },
    schema: [],
    messages: {
      utility:
        "`{{utility}}` of `{{prop}}` launders a CSS door instead of closing it. Remove the prop from the owning public contract and every consumer.",
    },
  },
  create(context) {
    const file = String(context.filename || context.getFilename()).replace(/\\/g, "/")
    if (isTestFile(file) || !file.includes("/src/")) return {}
    return {
      TSTypeReference(node) {
        const utility = node.typeName?.type === "Identifier" ? node.typeName.name : null
        if (!utility || !["Omit", "Pick", "Exclude"].includes(utility)) return
        const params = node.typeArguments?.params || node.typeParameters?.params || []
        const prop = typeKeys(params[1]).find((key) => key === "className" || key === "classNames" || key === "style")
        if (prop) context.report({ node, messageId: "utility", data: { utility, prop } })
      },
    }
  },
}

// -- SLOTS-7 ---------------------------------------------------------------------------------------

/** A joined-list surface receives domain collections through named props, never a generic items lane. */
export const noSurfaceListItemsSlot = {
  meta: {
    type: "problem",
    docs: { description: "SurfaceListCard receives collection data through named props, never items." },
    schema: [],
    messages: {
      items:
        "`items` creates a second runtime-data lane beside `props` and makes SurfaceListCard know every domain collection. Put the collection in the render component's named props type (for example `tasks`) and pass it through `props`.",
    },
  },
  create(context) {
    const filename = String(context.filename || context.getFilename()).replace(/\\/g, "/")
    if (!filename.includes("/src/")) return {}
    const bindings = new Set()
    return {
      ImportDeclaration(node) {
        const source = String(node.source?.value || "").replace(/\\/g, "/")
        if (!/(?:^|\/)components\/branches\/SurfaceListCard$/.test(source)) return
        for (const specifier of node.specifiers || []) {
          const imported = specifier.imported?.name
          if (imported === "SurfaceListCard" && specifier.local?.name) bindings.add(specifier.local.name)
        }
      },
      JSXOpeningElement(node) {
        const component = node.name?.type === "JSXIdentifier" ? node.name.name : null
        if (!component || !bindings.has(component)) return
        for (const attribute of node.attributes || []) {
          if (attribute.type !== "JSXAttribute") continue
          if (attribute.name?.type === "JSXIdentifier" && attribute.name.name === "items") {
            context.report({ node: attribute, messageId: "items" })
          }
        }
      },
    }
  },
}

/** The rules this law contributes to the plugin. */
export const rules = {
  "no-inline-parameter-type": noInlineParameterType,
  "no-children-slot": noChildrenSlot,
  "no-per-part-classname-prop": noPerPartClassNameProp,
  "no-public-classname-prop": noPublicClassNameProp,
  "no-public-frame-css-props": noPublicFrameCssProps,
  "no-css-door-type-laundering": noCssDoorTypeLaundering,
  "no-surface-list-items-slot": noSurfaceListItemsSlot,
}

/**
 * The level this law asks for, as the plugin's own opinion.
 *
 * Exact and mechanical: it fires on a syntactic shape rather than on a judgement, so there is no
 * false-positive risk that would justify adopting it at `warn`.
 */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
