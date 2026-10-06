import { describe, expect, test } from "bun:test";
import {
  applyVersion,
  bumpFor,
  nextVersion,
  prependRelease,
  releaseLine,
} from "../scripts/release/bump";

describe("bump", () => {
  test("title type decides the bump", () => {
    expect(bumpFor("fix: tray flicker", "")).toBe("patch");
    expect(bumpFor("perf(tray): fewer redraws", "")).toBe("patch");
    expect(bumpFor("feat: picker search", "")).toBe("minor");
    expect(bumpFor("feat!: rename actions", "")).toBe("major");
    expect(bumpFor("fix: x", "BREAKING CHANGE: state v2")).toBe("major");
    expect(bumpFor("docs: readme", "")).toBeNull();
    expect(bumpFor("not conventional", "")).toBeNull();
  });
  test("semver arithmetic, with 0.x breaking changes bumping minor", () => {
    expect(nextVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(nextVersion("0.1.3", "minor")).toBe("0.2.0");
    expect(nextVersion("0.4.2", "major")).toBe("0.5.0");
    expect(nextVersion("1.4.2", "major")).toBe("2.0.0");
  });
  test("applyVersion rewrites only the top-level version lines", () => {
    const toml = 'id = "mmss.minimize"\nversion = "0.1.0"\nmin_herdr_version = "0.9.3"\n';
    expect(applyVersion(toml, "0.2.0")).toBe(
      'id = "mmss.minimize"\nversion = "0.2.0"\nmin_herdr_version = "0.9.3"\n',
    );
  });

  test("the changelog gets a dated section above the previous release", () => {
    const before = "# Changelog\n\nIntro.\n\n## [0.1.0] - 2026-10-06\n\n- first\n";
    expect(prependRelease(before, "0.1.1", "2026-10-07", "- tray flicker (#3)")).toBe(
      "# Changelog\n\nIntro.\n\n## [0.1.1] - 2026-10-07\n\n- tray flicker (#3)\n\n## [0.1.0] - 2026-10-06\n\n- first\n",
    );
  });
  test("the release line is the title without its type prefix, linked to the PR", () => {
    expect(releaseLine("fix(picker): keep selection on refresh", "12")).toBe(
      "- keep selection on refresh (#12)",
    );
    expect(releaseLine("feat!: rename actions", "3")).toBe("- rename actions (#3)");
  });
});
