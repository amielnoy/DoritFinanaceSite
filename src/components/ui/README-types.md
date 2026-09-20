# Typed surface for the shadcn primitives

The primitives in this folder are the untyped `.jsx` files shadcn generated.
TypeScript resolves a sibling `.d.ts` ahead of a `.jsx` of the same name, so
the handful of primitives that `.tsx` files import get a declaration file here
and nothing else changes: Vite still bundles the `.jsx`, and the `.jsx` stays
excluded from `tsc` (see `tsconfig.json`).

Before these existed every prop passed to one of them was a `TS2322`
("IntrinsicAttributes & RefAttributes<any>"), which is what the old
`typecheck-gate` ratchet was tolerating. Add a `.d.ts` whenever a `.tsx` file
starts importing a primitive that has none — `tsc` will tell you.
