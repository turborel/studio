/**
 * The dock's panels and their first layout (RULES.md D14): the Object
 * Explorer on the left, worksheets and models in the centre, details and
 * the assistant on the right.
 */
import type { DockviewApi } from "dockview-react";

/** The panels the dock can hold, by component name. */
export const PANELS = {
  explorer: { id: "explorer", title: "Explorer" },
  welcome: { id: "welcome", title: "Start" },
  details: { id: "details", title: "Details" },
  worksheet: { id: "worksheet", title: "Worksheet" },
  model: { id: "model", title: "Model" },
  assistant: { id: "assistant", title: "Assistant" },
  live: { id: "live", title: "Live Session" },
  monitor: { id: "monitor", title: "Monitor" },
  debugger: { id: "debugger", title: "Debugger" },
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
  api.addPanel({
    id: PANELS.assistant.id,
    component: PANELS.assistant.id,
    title: PANELS.assistant.title,
    position: { referencePanel: PANELS.details.id, direction: "within" },
    inactive: true,
  });
}

/** Shows panel `id`, added where its kind goes if the layout has it not. */
export function showPanel(
  api: DockviewApi,
  id:
    | typeof PANELS.assistant.id
    | typeof PANELS.details.id
    | typeof PANELS.live.id
    | typeof PANELS.monitor.id
    | typeof PANELS.debugger.id,
): void {
  const panel = api.getPanel(id);
  if (panel !== undefined) {
    panel.api.setActive();
    return;
  }
  const beside = api.getPanel(PANELS.details.id) ?? api.getPanel(PANELS.welcome.id);
  api.addPanel({
    id,
    component: id,
    title: PANELS[id].title,
    ...(beside === undefined ? {} : { position: { referencePanel: beside.id, direction: "within" as const } }),
  });
}
