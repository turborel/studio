import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { onStudioEvent, STUDIO_EVENT, type StudioEvent } from "./events";

describe("the backend's events", () => {
  it("are given to the handler as the backend tells them [DESIGN] D24", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const told: StudioEvent[] = [];
    const unlisten = await onStudioEvent((event) => told.push(event));
    const lost = {
      kind: "lost",
      connection: 3,
      error: { sqlcode: -919, sqlstate: "08006", message: "lost" },
    };
    await emit(STUDIO_EVENT, lost);
    expect(told).toEqual([lost]);
    unlisten();
  });
});
