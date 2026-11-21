import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "7189b102f79059f5d587d025a6efcc8d63b843e9" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "7189b102f79059f5d587d025a6efcc8d63b843e9",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
