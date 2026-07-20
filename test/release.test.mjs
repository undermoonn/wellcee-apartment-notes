import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = new URL("../", import.meta.url);
const readProjectFile = (path) =>
  readFile(new URL(path, projectRoot), "utf8");

test("release metadata and tag version stay aligned", async () => {
  const [packageJson, manifest] = await Promise.all([
    readProjectFile("package.json").then(JSON.parse),
    readProjectFile("manifest.json").then(JSON.parse)
  ]);

  assert.equal(manifest.version, packageJson.version);
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/verify-release-version.mjs", `v${packageJson.version}`],
    { cwd: projectRoot }
  );
  assert.match(stdout, /Release version .* verified/);
});

test("tag workflow publishes the built distribution through GitHub Release", async () => {
  const workflow = await readProjectFile(".github/workflows/release.yml");

  assert.match(workflow, /tags:\s*\n\s*- "v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /origin\/main/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /package_root="release\/wellcee-apartment-notes"/);
  assert.match(workflow, /cp -R dist\/\./);
  assert.match(workflow, /zip -q -r "\.\.\/\$\{archive\}" wellcee-apartment-notes/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /#Wellcee 房源笔记 Chrome 扩展安装包/);
  assert.match(workflow, /#SHA-256 checksum/);
  assert.match(workflow, /\.sha256/);
});

test("pre-commit hook runs typecheck and tests", async () => {
  const [packageJson, hook, installer] = await Promise.all([
    readProjectFile("package.json").then(JSON.parse),
    readProjectFile(".githooks/pre-commit"),
    readProjectFile("scripts/install-git-hooks.mjs")
  ]);

  assert.equal(
    packageJson.scripts.prepare,
    "node scripts/install-git-hooks.mjs"
  );
  assert.match(hook, /^#!\/bin\/sh/);
  assert.match(hook, /pnpm typecheck\s+pnpm test/);
  assert.match(installer, /"core\.hooksPath", "\.githooks"/);
});
