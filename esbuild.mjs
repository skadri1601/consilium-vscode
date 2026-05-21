// @ts-check
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const extensionConfig = {
  entryPoints: [path.join(__dirname, "src/extension.ts")],
  bundle: true,
  outfile: path.join(__dirname, "dist/extension.js"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !isProd,
  minify: isProd,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const webviewConfig = {
  entryPoints: [path.join(__dirname, "src/webview/debate.ts")],
  bundle: true,
  outfile: path.join(__dirname, "dist/webview/debate.js"),
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: !isProd,
  minify: isProd,
  logLevel: "info",
  loader: { ".css": "text" },
};

try {
  if (isWatch) {
    const ctx1 = await esbuild.context(extensionConfig);
    const ctx2 = await esbuild.context(webviewConfig);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log("[esbuild] watching extension + webview…");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log("[esbuild] build complete.");
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
