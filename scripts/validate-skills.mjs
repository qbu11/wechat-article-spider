#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const skillsRoot = resolve(root, "skills");
const errors = [];

for (const entry of (await readdir(skillsRoot)).sort()) {
  const directory = resolve(skillsRoot, entry);
  if (!(await stat(directory)).isDirectory()) continue;
  const source = await readFile(resolve(directory, "SKILL.md"), "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    errors.push(`${entry}: SKILL.md must start with YAML frontmatter`);
    continue;
  }
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      errors.push(`${entry}: invalid frontmatter line ${JSON.stringify(line)}`);
      continue;
    }
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ""));
  }
  for (const key of fields.keys()) {
    if (!new Set(["name", "description"]).has(key)) errors.push(`${entry}: unsupported frontmatter key ${key}`);
  }
  if (fields.get("name") !== entry) errors.push(`${entry}: name must match folder name`);
  const description = fields.get("description") ?? "";
  if (!description || description.length > 1024) errors.push(`${entry}: description must be 1-1024 characters`);
  if (!source.slice(match[0].length).trim()) errors.push(`${entry}: workflow body is empty`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("All bundled Agent Skills are valid.");
