import { mockIPC } from "@tauri-apps/api/mocks";
import { appInfo } from "./commands";

describe("the commands", () => {
  it("asks the backend for app_info and gives its answer [DESIGN] D1", async () => {
    const asked: string[] = [];
    mockIPC((command) => {
      asked.push(command);
      return { version: "0.0.0", turborelCommit: "5863fe6521d3a2fc89fce6159295fabfca053c00", home: "/home/ann" };
    });
    await expect(appInfo()).resolves.toEqual({
      version: "0.0.0",
      turborelCommit: "5863fe6521d3a2fc89fce6159295fabfca053c00",
      home: "/home/ann",
    });
    expect(asked).toEqual(["app_info"]);
  });
});
