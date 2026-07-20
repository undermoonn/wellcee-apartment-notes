import { readFile } from "node:fs/promises";

const tag = process.argv[2];
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag || "");

if (!match) {
  throw new Error("Release tag must use the v<major>.<minor>.<patch> format.");
}

const releaseVersion = match[1];
const [packageJson, sourceManifest, distributedManifest] = await Promise.all(
  ["../package.json", "../manifest.json", "../dist/manifest.json"].map(
    async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"))
  )
);

const versions = new Map([
  ["Git tag", releaseVersion],
  ["package.json", packageJson.version],
  ["manifest.json", sourceManifest.version],
  ["dist/manifest.json", distributedManifest.version]
]);

const mismatches = [...versions].filter(([, version]) => version !== releaseVersion);
if (mismatches.length > 0) {
  const details = [...versions]
    .map(([source, version]) => `${source}: ${version}`)
    .join("\n");
  throw new Error(`Release versions do not match:\n${details}`);
}

console.log(`Release version ${releaseVersion} verified.`);
