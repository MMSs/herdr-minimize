import { activeContext, minimize } from "../ops";
import { runEntrypoint } from "../run";

await runEntrypoint(() => minimize(activeContext()));
