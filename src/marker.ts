// The "▾" appended to the name of a tab that has minimized panes. herdr has
// no plugin-drawn tab markers, so it lives in the tab's label; the reconcile
// hook puts it back if the user renames the tab while panes are minimized.

export const MARKER = " ▾";

export const marked = (label: string): string =>
  label.endsWith(MARKER) ? label : `${label}${MARKER}`;

export const unmarked = (label: string): string =>
  label.endsWith(MARKER) ? label.slice(0, -MARKER.length) : label;
