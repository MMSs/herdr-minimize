import { herdr } from "./herdr";
import { UserError } from "./ops";

/**
 * Runs an entry point. Failures of something the user triggered become herdr
 * notifications; `quiet` entry points (background hooks) only log them, to
 * herdr's plugin log, since the user never asked for them.
 */
export async function runEntrypoint(
  fn: () => Promise<void>,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!quiet) {
      try {
        herdr.notify(e instanceof UserError ? "Minimize" : "Minimize failed", message);
      } catch {
        // notification is best-effort; the log below still records it
      }
    }
    if (quiet || !(e instanceof UserError)) {
      console.error(e);
      process.exitCode = 1;
    }
  }
}
