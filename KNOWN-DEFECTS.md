# Known defects

Four assertions are red, from **three different causes**. Nothing is skipped: a gate bent to go green
stops being a gate, and each of these is the only evidence its problem exists.

```text
npm run test:fe   88 pass · 1 fail
npm run test:be   54 pass · 3 fail
```

## 1. A real defect: three rule names are published by two laws each

`packages/be` — `index.test.mjs`, two assertions:

```text
✖ no two laws publish the same rule name
✖ every declared rule survives into the published set   40 !== 37
```

Both `e2e-flow` and `testing` publish these three names, with **different implementations**:

| Rule name | `e2e-flow` | `testing` |
|---|---|---|
| `e2e-uses-production-transport` | 1388 chars | 991 chars |
| `e2e-asserts-persisted-state` | 421 chars | 371 chars |
| `no-model-call-in-e2e` | 452 chars | 432 chars |

Merging the two law modules keeps whichever imports last and discards the other silently: 40 rules are
declared, 37 ship, and no message says which three were dropped or which version won.

**What it needs:** an owner decision per rule — which law owns the name, and which implementation ships.
"Bigger is more complete" is a guess, not a reason: the two versions may disagree about what they refuse,
and that disagreement is the thing to settle.

## 2. A twin test that reads the trust tree

`packages/fe` — `icon.test.mjs`:

```text
ENOENT: no such file or directory, open '<repo>/patterns/fe/icon/INDEX.md'
```

The test asserts the rule agrees with its own law document. In the previous home the package sat inside
the trust tree, so the path resolved by accident of layout. It ships alone now, and the law is in another
repository.

That check is worth keeping — a rule with no law is unaccountable — but it cannot resolve a path that
only exists on a machine with the tree checked out. It needs a **declared input** (a trust-root
environment variable, skipped with a printed reason when unset) or it belongs on the tree's side, beside
the law it verifies. Both are decisions, not repairs.

## 3. A twin test that reads a product repository

`packages/be` — `e2e-flow.test.mjs`:

```text
✖ the canonical business inventory contains every executable flow suite
```

The assertion compares the rule's inventory against the e2e suites of a **backend product checkout**. A
lint package cannot carry that: the product is one of several that use these rules, and which one is
never knowable from here.

Same shape as cause 2, and the same two ways out.

## Why none of them is patched here

Causes 2 and 3 are couplings this package inherited from living inside the trust tree; deciding where
those checks belong changes the tree, not the package. Cause 1 is a canon question about rule ownership.
The tests stay red so that all three keep asking.

## `no-shell-tier` is held back from `@starci/eslint-canon-fe`

Ported nothing: the rule bans a `shells/` tier outright, while this package's own
`file-layout.mjs` lists `shells` among the vocabulary tiers a shared package may hold. Two rules in
one plugin cannot disagree about whether a tier exists, and the trust tree names `shells` exactly once
— in a template enumeration — which is too thin to settle it.

Blocked on the law, not on the code: `compilers/patterns/fe/file-layout` has to say whether a
`shells/` folder is a tier. Whichever way it rules, one of these two has to change.
