// Installs the resolve hook in scripts/resolve-ts.mjs. Hooks run on their own thread, so they
// have to live in a separate module from the call that registers them.

import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
