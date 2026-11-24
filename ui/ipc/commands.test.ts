import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "1107664016d3e34199e8ae906133efbb66eaa436", home: "/home/ann" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "1107664016d3e34199e8ae906133efbb66eaa436",
      home: "/home/ann",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
