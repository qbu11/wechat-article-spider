#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifests = [
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];

for (const relative of manifests) {
  const source = await readFile(resolve(root, relative), "utf8");
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${relative} must contain a JSON object`);
  if (/mcpServers|\.mcp\.json/i.test(source)) throw new Error(`${relative} must remain skills-only`);
}

console.log("Skills-only plugin manifests are valid JSON.");
