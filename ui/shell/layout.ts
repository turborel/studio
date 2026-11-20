/**
 * The dock's panels and their first layout (RULES.md D14): the Object
 * Explorer on the left, worksheets in the centre, details on the right.
 */
import type { DockviewApi } from "dockview-react";

/** The panels the dock can hold, by component name. */
export const PANELS = {
  explorer: { id: "explorer", title: "Explorer" },
  welcome: { id: "welcome", title: "Start" },
  details: { id: "details", title: "Details" },
} as const;

/** The width of the side panels as the layout first opens, in pixels. */
export const SIDE_WIDTH = 280;

/** Lays out the default panels in an empty dock. */
export function defaultLayout(api: DockviewApi): void {
  api.addPanel({ id: PANELS.welcome.id, component: PANELS.welcome.id, title: PANELS.welcome.title });
  api.addPanel({
    id: PANELS.explorer.id,
    component: PANELS.explorer.id,
    title: PANELS.explorer.title,
    position: { referencePanel: PANELS.welcome.id, direction: "left" },
    initialWidth: SIDE_WIDTH,
  });
  api.addPanel({
    id: PANELS.details.id,
    component: PANELS.details.id,
    title: PANELS.details.title,
    position: { referencePanel: PANELS.welcome.id, direction: "right" },
    initialWidth: SIDE_WIDTH,
  });
}
