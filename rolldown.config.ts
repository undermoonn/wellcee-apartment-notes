import { defineConfig } from "rolldown";
import type { OutputOptions } from "rolldown";

const sharedOutput = {
  format: "iife",
  minify: true,
  comments: {
    legal: true
  }
} satisfies OutputOptions;

export default defineConfig([
  {
    input: "src/content.ts",
    platform: "browser",
    output: {
      ...sharedOutput,
      file: "dist/content.js"
    }
  },
  {
    input: "src/background.ts",
    platform: "browser",
    output: {
      ...sharedOutput,
      file: "dist/background.js"
    }
  },
  {
    input: "sidepanel/sidepanel.ts",
    platform: "browser",
    output: {
      ...sharedOutput,
      file: "dist/sidepanel.js"
    }
  }
]);
