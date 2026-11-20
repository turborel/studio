import keyboard from "../../doc/appendix/a-keyboard.md?raw";
import { COMMANDS } from "./commands";
import { shown } from "./keys";

/** The rows of the appendix's table: command, menu, macOS key, other key. */
function rows(): string[][] {
  return keyboard
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Command | Menu |") && !line.startsWith("|---"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe("the manual's keyboard shortcuts", () => {
  it("list every command, in order, with its default keys [STUDIO Keyboard Shortcuts]", () => {
    expect(rows()).toEqual(
      COMMANDS.map((c) => [
        c.title,
        c.category,
        c.key === undefined ? "" : shown(c.key, true),
        c.key === undefined ? "" : shown(c.key, false),
      ]),
    );
  });
});
