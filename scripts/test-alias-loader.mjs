// Lets `node --test` resolve the "@/…" import alias the app uses everywhere.
//
// Next understands the alias from tsconfig; plain Node does not, so without
// this the test runner cannot import any module that uses it — which is nearly
// all of them.

import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

// TypeScript resolves an extensionless import to the .ts file; Node needs to be
// told which one, so the candidates are tried in the same order tsc uses.
const SUFFIXES = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

function firstExisting(base) {
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

// Next's package exports leave "next/server" to the bundler; plain Node needs
// the file. Without this no API route can be imported by a test at all.
const BARE_TO_FILE = { "next/server": "next/server.js" };

export function resolve(specifier, context, nextResolve) {
  if (BARE_TO_FILE[specifier]) {
    return nextResolve(BARE_TO_FILE[specifier], context);
  }

  if (specifier.startsWith("@/")) {
    const found = firstExisting(resolvePath(root, specifier.slice(2)));
    if (found) return { url: found, shortCircuit: true };
  }

  // TypeScript also allows extensionless relative imports ("./jsonResponse"),
  // which Node refuses on its own.
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const found = firstExisting(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    if (found) return { url: found, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
