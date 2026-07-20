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
    input: "popup/popup.ts",
    platform: "browser",
    output: {
      ...sharedOutput,
      file: "dist/popup.js"
    }
  }
]);
