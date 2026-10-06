import { HerdrError, herdr } from "../herdr";
import { activeContext, liveViews, restoreEntry, UserError } from "../ops";
import { runEntrypoint } from "../run";

await runEntrypoint(async () => {
  const { tab } = activeContext();
  const [only, ...more] = liveViews(tab);
  if (!only) throw new UserError("No minimized panes in this tab.");
  if (more.length === 0) return restoreEntry(tab, only.terminal_id);
  try {
    herdr.openPluginPane("picker"); // manifest placement: popup
  } catch (e) {
    if (e instanceof HerdrError && e.code === "ui_busy") {
      throw new UserError("Close the open herdr dialog first.");
    }
    throw e;
  }
});
