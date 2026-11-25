#!/usr/bin/env node
/* Copies the content script, its stylesheet, and the fonts into docs/try,
   so the live demo on the website runs the same code the extension ships.
   The one change is the font address, which points at the extension in
   the original. Run this after editing anything in content/.

   Usage:  node tools/sync-site.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/try");
fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true });

fs.copyFileSync(path.join(ROOT, "content/content.js"), path.join(OUT, "content.js"));
const css = fs.readFileSync(path.join(ROOT, "content/content.css"), "utf8");
fs.writeFileSync(
  path.join(OUT, "content.css"),
  css.replaceAll("chrome-extension://__MSG_@@extension_id__/fonts/", "fonts/")
);
for (const file of ["OpenDyslexic-Regular.woff2", "OpenDyslexic-Bold.woff2", "OFL.txt"]) {
  fs.copyFileSync(path.join(ROOT, "fonts", file), path.join(OUT, "fonts", file));
}
console.log("docs/try is in sync with content/");
