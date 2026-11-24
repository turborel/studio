import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PALETTES } from "../../theme/tokens";
import { cssVariable } from "../../theme/theme";
import { editorTheme, SYNTAX } from "./theme";

describe("the editor's colours", () => {
  it("draw each token, the gutter, the active line and the popups of the theme's own variables [DESIGN] D74", () => {
    const rules = SYNTAX.module?.getRules() ?? "";
    for (const key of Object.keys(PALETTES.dark).filter((k) => k.startsWith("syn"))) {
      expect(rules).toContain(`var(${cssVariable(key)})`);
    }
    const view = new EditorView({ state: EditorState.create({ doc: "SELECT 1", extensions: editorTheme() }) });
    const styles = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    for (const key of [
      "editorActiveLine",
      "gutterBackground",
      "gutterText",
      "popupBackground",
      "popupSelected",
      "popupMuted",
    ]) {
      expect(styles).toContain(`var(${cssVariable(key)})`);
    }
    view.destroy();
  });
});
