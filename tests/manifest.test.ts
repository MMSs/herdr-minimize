// Static checks on herdr-plugin.toml. herdr only validates the manifest at
// install/link time, and the marketplace silently drops manifests it can't
// parse, so catch mistakes here instead.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");
const manifest = Bun.TOML.parse(await Bun.file(join(root, "herdr-plugin.toml")).text()) as Record<
  string,
  unknown
>;

type Entry = { id?: string; command?: string[]; platforms?: string[] };
const entries = (table: string): Entry[] => (manifest[table] as Entry[] | undefined) ?? [];
const commandTables = ["build", "startup", "actions", "events", "panes"];
const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe("herdr-plugin.toml", () => {
  test("has the required metadata", () => {
    for (const key of ["id", "name", "version", "min_herdr_version"]) {
      expect(typeof manifest[key]).toBe("string");
    }
    expect(manifest.id).toMatch(/^[A-Za-z0-9.:_-]+$/);
    expect(manifest.version).toMatch(semver);
    expect(manifest.min_herdr_version).toMatch(semver);
  });

  test("version matches package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  test("declares only supported platforms", () => {
    const all = [
      manifest.platforms,
      ...commandTables.flatMap((t) => entries(t).map((e) => e.platforms)),
    ];
    for (const platforms of all.filter(Boolean) as string[][]) {
      for (const p of platforms) expect(["linux", "macos", "windows"]).toContain(p);
    }
  });

  test("local ids are valid and unique per table", () => {
    for (const table of ["actions", "panes", "link_handlers"]) {
      const ids = entries(table).map((e) => e.id);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9:_-]+$/);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("every command is an argv array whose repo files exist", () => {
    for (const table of commandTables) {
      for (const entry of entries(table)) {
        expect(Array.isArray(entry.command)).toBe(true);
        expect(entry.command?.length).toBeGreaterThan(0);
        // herdr runs commands from the plugin root without a shell, so any
        // argument that names a repo file must exist relative to the root.
        for (const arg of entry.command ?? []) {
          if (/^(\.\/)?(src|scripts|bin|dist)\//.test(arg)) {
            expect(existsSync(join(root, arg)), `${table}: ${arg}`).toBe(true);
          }
        }
      }
    }
  });
});
