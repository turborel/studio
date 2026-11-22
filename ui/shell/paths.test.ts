import { shortPath } from "./paths";

describe("paths as the window shows them", () => {
  it("write a path beneath the home folder from ~, of either separator, and leave others whole [RULE] R-UI-1", () => {
    expect(shortPath("/home/ann/Databases/shop", "/home/ann")).toBe("~/Databases/shop");
    expect(shortPath("/home/ann", "/home/ann/")).toBe("~");
    expect(shortPath("C:\\Users\\Ann\\shop", "C:\\Users\\Ann")).toBe("~\\shop");
    expect(shortPath("/home/anne/shop", "/home/ann")).toBe("/home/anne/shop");
    expect(shortPath("/tmp/shop", "/home/ann")).toBe("/tmp/shop");
    expect(shortPath("/home/ann/shop", null)).toBe("/home/ann/shop");
    expect(shortPath("/home/ann/shop", "")).toBe("/home/ann/shop");
  });
});
