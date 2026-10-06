import { herdr } from "./herdr";
import { UserError } from "./ops";

/** Runs an entry point; turns failures into herdr notifications. */
export async function runEntrypoint(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      herdr.notify(e instanceof UserError ? "Minimize" : "Minimize failed", message);
    } catch {
      // notification is best-effort; the log below still records it
    }
    if (!(e instanceof UserError)) {
      console.error(e);
      process.exitCode = 1;
    }
  }
}
