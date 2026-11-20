import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "8052705ecab0f3cd9668f992ff14505c7a60f5dc" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "8052705ecab0f3cd9668f992ff14505c7a60f5dc",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
