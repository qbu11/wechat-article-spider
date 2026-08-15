import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { appDataDir, findPackageRoot, skillTargetRoot } from "./paths.js";
import type { AgentTarget, InstallScope } from "./paths.js";

const PACKAGE_NAME = "@qbu11/wechat-agent-kit";
const PACKAGE_VERSION = "0.2.0";

export interface InstallOptions {
  agents: AgentTarget[];
  scope: InstallScope;
  dryRun: boolean;
  yes: boolean;
  cwd?: string;
  userHome?: string;
  packageRoot?: string;
  dataDir?: string;
}

export interface InstallOperation {
  action: "copy" | "backup" | "remove" | "skip";
  target: string;
  detail: string;
}

interface OwnedFile {
  agent: AgentTarget;
  scope?: InstallScope;
  path: string;
  digest: string;
}

interface OwnershipManifest {
  package: string;
  version: string;
  installedAt: string;
  files: OwnedFile[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function digestDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = join(path, entry.name);
      hash.update(entry.name);
      if (entry.isDirectory()) await visit(child);
      else hash.update(await readFile(child));
    }
  };
  await visit(root);
  return hash.digest("hex");
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function planInstall(options: InstallOptions): Promise<InstallOperation[]> {
  const packageRoot = options.packageRoot ?? findPackageRoot();
  const operations: InstallOperation[] = [];
  const skills = await readdir(join(packageRoot, "skills"), { withFileTypes: true });
  for (const agent of options.agents) {
    const targetRoot = skillTargetRoot(agent, options.scope, options.cwd, options.userHome);
    for (const skill of skills.filter((entry) => entry.isDirectory())) {
      const target = join(targetRoot, skill.name);
      if (await pathExists(target)) {
        operations.push({ action: "backup", target, detail: "Existing skill will be backed up before replacement." });
      }
      operations.push({ action: "copy", target, detail: `Install ${skill.name} for ${agent}.` });
    }
  }
  return operations;
}

export async function install(options: InstallOptions): Promise<InstallOperation[]> {
  const operations = await planInstall(options);
  if (options.dryRun) return operations;
  if (!options.yes) throw new Error("Installation requires explicit confirmation. Re-run with --yes after reviewing --dry-run.");

  const packageRoot = options.packageRoot ?? findPackageRoot();
  const dataRoot = options.dataDir ?? appDataDir();
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const owned: OwnedFile[] = [];
  const skills = await readdir(join(packageRoot, "skills"), { withFileTypes: true });

  for (const agent of options.agents) {
    const targetRoot = skillTargetRoot(agent, options.scope, options.cwd, options.userHome);
    await mkdir(targetRoot, { recursive: true });
    for (const skill of skills.filter((entry) => entry.isDirectory())) {
      const source = join(packageRoot, "skills", skill.name);
      const target = join(targetRoot, skill.name);
      if (await pathExists(target)) {
        const backup = join(dataRoot, "backups", stamp, agent, skill.name);
        await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
        await cp(target, backup, { recursive: true, force: false, errorOnExist: true });
        await rm(target, { recursive: true });
      }
      const temporary = join(targetRoot, `.${skill.name}.${process.pid}.tmp`);
      await cp(source, temporary, { recursive: true, force: false, errorOnExist: true });
      await rename(temporary, target);
      owned.push({ agent, scope: options.scope, path: target, digest: await digestDirectory(target) });
    }
  }

  const manifest: OwnershipManifest = {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    installedAt: new Date().toISOString(),
    files: owned,
  };
  await atomicJson(join(dataRoot, "ownership.json"), manifest);
  return operations;
}

export async function uninstall(options: Omit<InstallOptions, "packageRoot">): Promise<InstallOperation[]> {
  const dataRoot = options.dataDir ?? appDataDir();
  const manifestPath = join(dataRoot, "ownership.json");
  if (!(await pathExists(manifestPath))) return [];
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as OwnershipManifest;
  const operations: InstallOperation[] = [];
  const remaining: OwnedFile[] = [];
  for (const file of manifest.files) {
    const targetRoot = skillTargetRoot(file.agent, options.scope, options.cwd, options.userHome);
    const targetRelative = relative(resolve(targetRoot), resolve(file.path));
    const requested =
      options.agents.includes(file.agent) &&
      (!file.scope || file.scope === options.scope) &&
      targetRelative.length > 0 &&
      !targetRelative.startsWith("..") &&
      !isAbsolute(targetRelative);
    if (!requested) {
      remaining.push(file);
      continue;
    }
    if (!(await pathExists(file.path))) continue;
    const currentDigest = await digestDirectory(file.path);
    if (currentDigest !== file.digest) {
      operations.push({ action: "skip", target: file.path, detail: "User-modified skill was preserved." });
      continue;
    }
    operations.push({ action: "remove", target: file.path, detail: "Remove an unmodified managed skill." });
    if (!options.dryRun) {
      if (!options.yes) throw new Error("Uninstall requires explicit confirmation. Re-run with --yes after reviewing --dry-run.");
      await rm(file.path, { recursive: true });
    }
  }
  if (!options.dryRun && options.yes) {
    if (remaining.length > 0) await atomicJson(manifestPath, { ...manifest, files: remaining });
    else await rm(manifestPath);
  }
  return operations;
}

export function formatOperations(operations: InstallOperation[]): string {
  return operations.map((operation) => `${operation.action.padEnd(13)} ${operation.target}\n  ${operation.detail}`).join("\n");
}

export function packageIdentity(): { name: string; version: string } {
  return { name: PACKAGE_NAME, version: PACKAGE_VERSION };
}
