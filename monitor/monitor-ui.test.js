import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, "..", "public", "monitor.html");
const cssPath = path.join(__dirname, "..", "public", "monitor.css");
const jsPath = path.join(__dirname, "..", "public", "monitor.js");

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

test("monitor.html references monitor.css and monitor.js", () => {
  const html = readHtml();
  assert.ok(html.includes("/monitor.css"));
  assert.ok(html.includes("/monitor.js"));
});

test("monitor assets exist", () => {
  assert.ok(fs.existsSync(cssPath));
  assert.ok(fs.existsSync(jsPath));
});
