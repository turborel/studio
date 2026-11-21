import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "406f617b6288665b75b7b68ffec3fe632f09207d" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "406f617b6288665b75b7b68ffec3fe632f09207d",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
