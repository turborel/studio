import { fireEvent, screen } from "@testing-library/react";
import { Store } from "../state/store";
import { mockBackend } from "../test/backend";
import { within } from "../test/catalog";
import { SettingsDialog } from "./SettingsDialog";

describe("the worksheet's settings", () => {
  it("keep the history or not, and set the formatter and the notification within their bounds [RULE] R-SEC-6", () => {
    const asked = mockBackend();
    const store = new Store();
    within(store, <SettingsDialog />);
    fireEvent.click(screen.getByLabelText("Keep a history of what runs"));
    fireEvent.change(screen.getByLabelText("Format key words in"), { target: { value: "lower" } });
    fireEvent.change(screen.getByLabelText("Format with an indentation of (spaces)"), { target: { value: "99" } });
    fireEvent.change(screen.getByLabelText("Format lines within (characters)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Notify a run's end, in the background, after (seconds; 0 for never)"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByLabelText("Show the toolbar's labels beside its icons"));
    expect(store.current().settings).toMatchObject({
      historyKept: false,
      formatKeyWords: "lower",
      formatIndent: 8,
      formatLineWidth: 60,
      notifyAfterSeconds: 0,
      toolbarLabels: true,
    });
    expect(asked.filter((a) => a.command === "save_settings")).toHaveLength(6);
  });
});
