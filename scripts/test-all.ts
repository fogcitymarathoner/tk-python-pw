import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", "dist", "coverage", ".git", "target"]);

type Scripts = { scripts?: Record<string, string> };

function packageScripts(dir: string): Record<string, string> {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return {};
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Scripts;
  return pkg.scripts ?? {};
}

function discover(dir: string, rel = ""): string[] {
  const found: string[] = [];
  const scripts = packageScripts(dir);
  if (rel && scripts.test) found.push(rel);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || skip.has(entry.name)) continue;
    found.push(...discover(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name));
  }
  return found;
}

const apps = discover(root);
if (apps.length === 0) {
  throw new Error("No test apps found.");
}

for (const app of apps) {
  const cwd = join(root, app);
  const scripts = packageScripts(cwd);
  console.log(`\n=== ${app}: npm test ===`);
  const unit = spawnSync("npm", ["test"], { cwd, stdio: "inherit", shell: true });
  if (unit.status !== 0) process.exit(unit.status ?? 1);

  if (scripts["test:coverage"]) {
    console.log(`\n=== ${app}: npm run test:coverage ===`);
    const coverage = spawnSync("npm", ["run", "test:coverage"], { cwd, stdio: "inherit", shell: true });
    if (coverage.status !== 0) process.exit(coverage.status ?? 1);
  }
  if (scripts["test:e2e"]) {
    console.log(`\n=== ${app}: npm run test:e2e ===`);
    const e2e = spawnSync("npm", ["run", "test:e2e"], { cwd, stdio: "inherit", shell: true });
    if (e2e.status !== 0) process.exit(e2e.status ?? 1);
  }
}
