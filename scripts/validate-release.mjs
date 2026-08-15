#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const errors = [];

async function json(relative) {
  return JSON.parse(await readFile(resolve(root, relative), "utf8"));
}

function expectEqual(location, actual, expected) {
  if (actual !== expected) errors.push(`${location}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

const packageJson = await json("package.json");
const version = packageJson.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  errors.push(`package.json version must be an exact semantic version, received ${JSON.stringify(version)}`);
}

const packageLock = await json("package-lock.json");
expectEqual("package-lock.json name", packageLock.name, packageJson.name);
expectEqual("package-lock.json version", packageLock.version, version);
expectEqual("package-lock.json packages[''] name", packageLock.packages?.[""]?.name, packageJson.name);
expectEqual("package-lock.json packages[''] version", packageLock.packages?.[""]?.version, version);
expectEqual(".codex-plugin/plugin.json version", (await json(".codex-plugin/plugin.json")).version, version);
expectEqual(".claude-plugin/plugin.json version", (await json(".claude-plugin/plugin.json")).version, version);

const marketplace = await json(".claude-plugin/marketplace.json");
expectEqual(".claude-plugin/marketplace.json version", marketplace.version, version);
const marketplaceEntry = marketplace.plugins?.find((entry) => entry?.name === "wechat-agent-kit");
expectEqual("marketplace plugin version", marketplaceEntry?.version, version);
expectEqual("marketplace source type", marketplaceEntry?.source?.source, "npm");
expectEqual("marketplace npm package", marketplaceEntry?.source?.package, packageJson.name);
expectEqual("marketplace npm source version", marketplaceEntry?.source?.version, version);

const expectedBins = {
  "wechat-agent-kit": "dist/packages/cli/cli.js",
  "wechat-agent": "dist/packages/cli/cli.js",
  "wechat-skills": "dist/packages/cli/cli.js",
};
expectEqual("package.json bin", JSON.stringify(packageJson.bin), JSON.stringify(expectedBins));

const skillDocs = [];
const referenceFiles = [];
for (const skill of await readdir(resolve(root, "skills"), { withFileTypes: true })) {
  if (!skill.isDirectory()) continue;
  skillDocs.push(`skills/${skill.name}/SKILL.md`);
  const references = resolve(root, "skills", skill.name, "references");
  for (const entry of await readdir(references, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) referenceFiles.push(`skills/${skill.name}/references/${entry.name}`);
  }
}

for (const relative of [...skillDocs, ...referenceFiles, "README.md", "README.en.md"]) {
  const source = await readFile(resolve(root, relative), "utf8");
  const npmReferences = [...source.matchAll(/@qbu11\/wechat-agent-kit@(\d+\.\d+\.\d+)/g)];
  const githubReferences = [...source.matchAll(/wechat-article-spider#v(\d+\.\d+\.\d+)/g)];
  for (const match of npmReferences) {
    expectEqual(`${relative} npm reference`, match[1], version);
  }
  for (const match of githubReferences) {
    expectEqual(`${relative} GitHub reference`, match[1], version);
  }
  if (relative.startsWith("skills/") && npmReferences.length === 0) {
    errors.push(`${relative}: expected an exact-version npm command`);
  }
  if ((referenceFiles.includes(relative) || relative.startsWith("README")) && githubReferences.length === 0) {
    errors.push(`${relative}: expected a fixed GitHub release-tag fallback`);
  }
  if (/(?:^|\n)wechat-agent\s/m.test(source)) {
    errors.push(`${relative}: found a bare wechat-agent command; Skills and examples must be npx-first`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Release metadata and pinned command references agree on ${version}.`);
