import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "3df14c1621d8063f12452a6c189017e34b8e9fd9" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "3df14c1621d8063f12452a6c189017e34b8e9fd9",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
