// Decides and applies the version bump for a merged PR from its
// Conventional Commit title. Run by .github/workflows/release.yml.
import { readFileSync, writeFileSync } from "node:fs";

export type Bump = "major" | "minor" | "patch";
const TITLE = /^(\w+)(\([^)]*\))?(!)?: (.+)$/;

export function bumpFor(title: string, body: string): Bump | null {
  const m = TITLE.exec(title);
  if (!m) return null;
  if (m[3] || /^BREAKING[ -]CHANGE:/m.test(body)) return "major";
  if (m[1] === "feat") return "minor";
  if (m[1] === "fix" || m[1] === "perf") return "patch";
  return null;
}

/** Semver bump; before 1.0 a breaking change bumps the minor version. */
export function nextVersion(current: string, bump: Bump): string {
  const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
  if (bump === "major") return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function applyVersion(toml: string, version: string): string {
  return toml.replace(/^version = "[^"]*"$/m, `version = "${version}"`);
}

export function releaseLine(title: string, pr: string): string {
  return `- ${TITLE.exec(title)?.[4] ?? title} (#${pr})`;
}

/** Inserts a dated section above the first existing "## " heading. */
export function prependRelease(
  changelog: string,
  version: string,
  date: string,
  line: string,
): string {
  const at = changelog.indexOf("\n## ");
  const section = `\n## [${version}] - ${date}\n\n${line}\n`;
  return at < 0
    ? `${changelog.trimEnd()}\n${section}`
    : `${changelog.slice(0, at)}${section}${changelog.slice(at)}`;
}

if (import.meta.main) {
  const [title = "", body = "", pr = ""] = Bun.argv.slice(2);
  const bump = bumpFor(title, body);
  if (!bump) {
    console.log(`no release for "${title}"`);
    process.exit(0);
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const version = nextVersion(pkg.version, bump);
  pkg.version = version;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(
    "herdr-plugin.toml",
    applyVersion(readFileSync("herdr-plugin.toml", "utf8"), version),
  );
  const line = releaseLine(title, pr);
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    "CHANGELOG.md",
    prependRelease(readFileSync("CHANGELOG.md", "utf8"), version, date, line),
  );
  writeFileSync(process.env.GITHUB_OUTPUT ?? "/dev/null", `version=${version}\nnotes=${line}\n`, {
    flag: "a",
  });
  console.log(`release ${version}: ${line}`);
}
