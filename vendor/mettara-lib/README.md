# mettara-lib

The Mettara Connect SDK, vendored so `import("mettara-lib")` resolves on the
server. Two files from Mettara live here:

- `mettara-lib.cjs` — the Node library the server loads. It is CommonJS, and
  it must keep the `.cjs` name: pnpm links this folder from outside
  `node_modules`, so a `.js` here would be transpiled by tsx as if it were
  project source, and its exports would be lost.
- `mettara-lib.ts` — the source, for reading. Not compiled or type-checked.

After changing anything here, `pnpm install` once.
