import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "ba8c845f27f24b736572e8aaf462b0adade9be29" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "ba8c845f27f24b736572e8aaf462b0adade9be29",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
