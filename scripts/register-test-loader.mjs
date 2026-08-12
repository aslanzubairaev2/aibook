// Entry point for `node --import`: installs the "@/…" alias resolver.
import { register } from "node:module";

register("./test-alias-loader.mjs", import.meta.url);
