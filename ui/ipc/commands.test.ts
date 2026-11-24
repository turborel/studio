import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "314a0042744497efc904befd19b954a89d6a4da6", home: "/home/ann" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "314a0042744497efc904befd19b954a89d6a4da6",
      home: "/home/ann",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
