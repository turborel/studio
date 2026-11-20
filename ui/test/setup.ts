/**
 * The one Vitest setup (RULES.md R-TEST-7): what jsdom lacks of a
 * webview, given to every test, and the IPC cleared after each.
 */
import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/** A media query list that never matches, as a light-themed system's. */
function mediaQueryList(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the interface still declares it
    addListener: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the interface still declares it
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  };
}

/** An observer of sizes that observes nothing: jsdom lays nothing out. */
class NoResizeObserver implements ResizeObserver {
  observe(): void {
    // jsdom lays nothing out, so no size ever changes.
  }
  unobserve(): void {
    // Nothing is observed.
  }
  disconnect(): void {
    // Nothing is observed.
  }
}

window.matchMedia = mediaQueryList;
globalThis.ResizeObserver = NoResizeObserver;

afterEach(async () => {
  cleanup();
  // A listener a component let go of is let go as its promise settles,
  // which is after the component is gone: the mocks wait for it.
  await new Promise((settled) => setTimeout(settled, 0));
  clearMocks();
});
