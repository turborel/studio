import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "829b5fb302c907cc26963baa8c5aacbdb5a4ca7a" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "829b5fb302c907cc26963baa8c5aacbdb5a4ca7a",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
