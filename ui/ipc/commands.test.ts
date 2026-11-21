import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "a4e9cf93ffa55c17eed814bb0d257d327ab05fc7" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "a4e9cf93ffa55c17eed814bb0d257d327ab05fc7",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
