import { EditorView } from "@codemirror/view";
import { register, viewOf } from "./views";

describe("the editors' registry", () => {
  it("keeps each worksheet's editor until it is let go, and only its own [DESIGN] D36", () => {
    const first = new EditorView();
    const second = new EditorView();
    const stopFirst = register("w", first);
    const stopSecond = register("w", second);
    stopFirst();
    expect(viewOf("w")).toBe(second);
    stopSecond();
    expect(viewOf("w")).toBeUndefined();
    expect(viewOf(null)).toBeUndefined();
    first.destroy();
    second.destroy();
  });
});
