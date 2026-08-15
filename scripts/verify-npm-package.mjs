#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const npmRunner = process.platform === "win32" ? "npx.cmd" : "npx";
const pinnedNpm = "npm@11.17.0";
const temporary = await mkdtemp(join(tmpdir(), "wechat-agent-npm-e2e-"));
const npmCache = join(temporary, "npm-cache");

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, npm_config_cache: npmCache, ...options.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}${stderr}`));
    });
  });
}

function npm1117(args, options) {
  return run(npmRunner, ["--yes", "--package", pinnedNpm, "npm", ...args], options);
}

try {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const expectedBins = {
    "wechat-agent-kit": "dist/packages/cli/cli.js",
    "wechat-agent": "dist/packages/cli/cli.js",
    "wechat-skills": "dist/packages/cli/cli.js",
  };
  for (const target of Object.values(expectedBins)) await access(join(root, target));

  const dryRun = await npm1117(["publish", "--dry-run", "--ignore-scripts", "--access", "public"]);
  const publishOutput = `${dryRun.stdout}\n${dryRun.stderr}`;
  if (/auto-corrected|script name .* invalid and removed|no bin file found/i.test(publishOutput)) {
    throw new Error(`npm ${pinnedNpm} changed or removed a bin during publish dry-run:\n${publishOutput}`);
  }

  const packed = await npm1117(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary]);
  const packResult = JSON.parse(packed.stdout);
  const filename = packResult?.[0]?.filename;
  if (!filename) throw new Error(`npm pack did not return a tarball filename:\n${packed.stdout}${packed.stderr}`);
  const tarball = join(temporary, basename(filename));

  const installRoot = join(temporary, "installed");
  await npm1117(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", installRoot, tarball]);
  const installedRoot = join(installRoot, "node_modules", "@qbu11", "wechat-agent-kit");
  const installedPackage = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  if (JSON.stringify(installedPackage.bin) !== JSON.stringify(expectedBins)) {
    throw new Error(`installed tarball has unexpected bins: ${JSON.stringify(installedPackage.bin)}`);
  }
  for (const target of Object.values(expectedBins)) await access(join(installedRoot, target));

  const skillNames = (await readdir(join(installedRoot, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedSkills = ["wechat-article", "wechat-search", "wechat-subscribe"];
  if (JSON.stringify(skillNames) !== JSON.stringify(expectedSkills)) {
    throw new Error(`installed tarball has unexpected skills: ${JSON.stringify(skillNames)}`);
  }
  for (const skill of expectedSkills) await access(join(installedRoot, "skills", skill, "SKILL.md"));

  const e2eRoot = join(temporary, "npx-project");
  await mkdir(e2eRoot);
  for (const executable of Object.keys(expectedBins)) {
    const result = await npm1117(
      ["exec", "--yes", "--package", tarball, "--", executable, "--version"],
      { cwd: e2eRoot, env: { npm_config_ignore_scripts: "true" } },
    );
    if (result.stdout.trim() !== packageJson.version) {
      throw new Error(`${executable} reported ${JSON.stringify(result.stdout.trim())}, expected ${packageJson.version}`);
    }
  }

  const installPlan = await npm1117(
    [
      "exec",
      "--yes",
      "--package",
      tarball,
      "--",
      "wechat-agent-kit",
      "install",
      "--dry-run",
      "--agent",
      "codex",
      "--scope",
      "project",
      "--json",
    ],
    { cwd: e2eRoot, env: { npm_config_ignore_scripts: "true" } },
  );
  const plan = JSON.parse(installPlan.stdout);
  if (!plan.success || plan.operations?.length !== expectedSkills.length) {
    throw new Error(`unexpected npx install dry-run output: ${installPlan.stdout}`);
  }

  console.log(`npm ${pinnedNpm} publish dry-run and ${basename(tarball)} npx E2E passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
