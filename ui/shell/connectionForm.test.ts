import type { SavedConnection } from "../ipc/saved";
import { formOf, invalid, NEW_TLS_MODE, passwordChangeOf, savedOf, specOf } from "./connectionForm";

const SAVED: SavedConnection = {
  id: "ab12",
  name: "Orders",
  folder: ["Team", "EU"],
  spec: { host: "db1.example,db2.example", user: "ann", tlsMode: "verify-ca" },
  environment: "production",
  colour: "#123456",
  readOnly: true,
  pinned: true,
  favourites: [],
};

describe("the connection dialog's fields", () => {
  it("give back the saved connection they were made of [DESIGN] D28", () => {
    expect(savedOf(formOf(SAVED))).toEqual(SAVED);
  });

  it("leave an empty setting out, so the layers below give it [CLIENT Where settings come from]", () => {
    const form = formOf(null);
    expect(specOf({ ...form, spec: { ...form.spec, user: " ann ", host: "" } })).toEqual({
      user: "ann",
      tlsMode: NEW_TLS_MODE,
    });
  });

  it("verify TLS for a new connection [DESIGN] D26", () => {
    expect(formOf(null).spec.tlsMode).toBe("verify-full");
  });

  it("read folders and colours as written [DESIGN] D28", () => {
    const form = { ...formOf(null), name: "X", folder: " Team /  / EU ", colour: "#abcdef" };
    expect(savedOf(form).folder).toEqual(["Team", "EU"]);
    expect(savedOf(form).colour).toBe("#ABCDEF");
    expect(savedOf({ ...form, colour: "" }).colour).toBeNull();
  });

  it("save a password only when asked, and keep the saved one otherwise [RULE] R-SEC-1", () => {
    const form = { ...formOf(SAVED), password: "secret" };
    expect(passwordChangeOf(form)).toEqual({ kind: "keep" });
    expect(passwordChangeOf({ ...form, savePassword: true })).toEqual({ kind: "save", password: "secret" });
    expect(passwordChangeOf({ ...form, savePassword: true, password: "" })).toEqual({ kind: "keep" });
  });

  it("say why a connection cannot be saved [RULE] R-SEC-6", () => {
    expect(invalid(formOf(null))).toBe("A connection needs a name.");
    expect(invalid({ ...formOf(null), name: "X" })).toBe("Give a URI, a user or a service.");
    expect(invalid(formOf(SAVED))).toBeNull();
  });
});
