import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("the window", () => {
  it("opens with the dock and a status bar saying no connection is open [DESIGN] D14", () => {
    render(<App />);
    expect(screen.getByRole("status", { name: "Status bar" }).textContent).toBe("Not connected");
    expect(document.querySelector(".dockview-theme-studio")).not.toBeNull();
  });

  it("applies the system's theme to the page [DESIGN] D20", () => {
    render(<App />);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#562024");
  });
});
