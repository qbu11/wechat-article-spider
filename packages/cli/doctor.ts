import { access, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { appDataDir, findPackageRoot } from "./paths.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const [major = 0, minor = 0] = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));
  const supportedNode = major > 22 || (major === 22 && minor >= 13);
  checks.push({
    name: "node",
    ok: supportedNode,
    detail: `Node ${process.versions.node}; Node 24 LTS is recommended and Node 22.13+ is supported.`,
  });

  try {
    const root = findPackageRoot();
    const skills = (await readdir(join(root, "skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    checks.push({ name: "skills", ok: skills.length >= 3, detail: `${skills.length} bundled skills found.` });
  } catch (error) {
    checks.push({ name: "skills", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const data = appDataDir();
    await mkdir(data, { recursive: true, mode: 0o700 });
    await access(data, constants.R_OK | constants.W_OK);
    checks.push({ name: "data-directory", ok: true, detail: data });
  } catch (error) {
    checks.push({ name: "data-directory", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const sqlite = await import("node:sqlite");
    const database = new sqlite.DatabaseSync(":memory:");
    database.exec("CREATE VIRTUAL TABLE check_fts USING fts5(content, tokenize='trigram')");
    database.close();
    checks.push({ name: "sqlite-fts5", ok: true, detail: "node:sqlite and FTS5 trigram are available." });
  } catch (error) {
    checks.push({ name: "sqlite-fts5", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return checks;
}
