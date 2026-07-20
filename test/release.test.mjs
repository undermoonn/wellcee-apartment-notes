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
  assert.match(workflow, /cd dist/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /\.sha256/);
});

test("CI validates pushes and pull requests targeting main", async () => {
  const workflow = await readProjectFile(".github/workflows/ci.yml");

  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm test/);
});
