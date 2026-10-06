// Startup and pane/tab lifecycle hook: forget panes that are gone, close the
// minimized panes of closed tabs, and keep every ▾ tab at the end.
import { keepParkingLast, reconcile } from "../ops";
import { runEntrypoint } from "../run";

await runEntrypoint(async () => {
  await reconcile();
  await keepParkingLast();
});
