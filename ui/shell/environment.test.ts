import { contrast } from "../theme/tokens";
import { ENVIRONMENT_COLOURS, tint } from "./environment";

describe("a connection's colour", () => {
  it("is its own, else its environment's, production red [DESIGN] D32", () => {
    expect(tint("production", null)).toBe("#B3261E");
    expect(tint("development", null)).toBeNull();
    expect(tint("development", "#123456")).toBe("#123456");
  });

  it("keeps the status bar's white text readable [RULE] R-UI-2", () => {
    for (const colour of Object.values(ENVIRONMENT_COLOURS)) {
      if (colour !== null) {
        expect(contrast("#FFFFFF", colour)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
