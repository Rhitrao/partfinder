// A resolve hook for `node --import ./scripts/register-ts.mjs`.
//
// Node 22 strips TypeScript types on its own, so a .ts script runs with no build step and no
// dependency. What it does not do is search for extensions, and the imports in src/ are written
// without one, as the Worker bundler expects. This hook tries "<specifier>.ts" for a relative
// import that has no extension, and otherwise changes nothing.

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Not a TypeScript file after all; fall through to the specifier as written.
    }
  }
  return nextResolve(specifier, context);
}
