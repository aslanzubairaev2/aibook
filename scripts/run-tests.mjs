import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Discover new tests automatically: a new critical regression must not be left
// out of CI because somebody forgot to extend a handwritten package.json list.
function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? discover(path) : /\.test\.(ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const critical = new Set(["dictionaryStore.test.ts", "photoImport.test.ts", "imageCrop.test.ts", "lessonModel.test.ts", "cards.test.ts", "activeTraining.test.ts"]);
const files = ["app", "components", "lib"].flatMap(discover)
  .filter((file) => !process.argv.includes("--critical") || critical.has(file.split(/[\\/]/).at(-1))).sort();
if (files.length === 0) throw new Error("No tests discovered");
const result = spawnSync(process.execPath, [
  "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
  "--test", "--test-timeout", "30000", ...files,
// Existing date fixtures use UTC midnight. Keep their calendar identical on
// Windows and CI; this affects only the test process, not the application's TZ.
], { stdio: "inherit", env: { ...process.env, TZ: "UTC" } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
