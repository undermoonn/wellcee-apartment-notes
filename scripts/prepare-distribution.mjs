import { copyFile, mkdir, rm } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const distributionRoot = new URL("../dist/", import.meta.url);

const distributionFiles = [
  ["LICENSE", "LICENSE"],
  ["manifest.json", "manifest.json"],
  ["src/content.css", "content.css"],
  ["sidepanel/base.css", "sidepanel/base.css"],
  ["sidepanel/sidepanel.html", "sidepanel/sidepanel.html"],
  ["sidepanel/sidepanel.css", "sidepanel/sidepanel.css"],
  ["assets/icons/icon-16.png", "assets/icons/icon-16.png"],
  ["assets/icons/icon-32.png", "assets/icons/icon-32.png"],
  ["assets/icons/icon-48.png", "assets/icons/icon-48.png"],
  ["assets/icons/icon-128.png", "assets/icons/icon-128.png"]
];

await rm(distributionRoot, { force: true, recursive: true });

for (const [sourcePath, outputPath] of distributionFiles) {
  const outputUrl = new URL(outputPath, distributionRoot);
  await mkdir(new URL("./", outputUrl), { recursive: true });
  await copyFile(new URL(sourcePath, projectRoot), outputUrl);
}
