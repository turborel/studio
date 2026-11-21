import { act, fireEvent, screen } from "@testing-library/react";
import type { LinkOpened } from "../ipc/live";
import { told } from "../state/actions";
import { catalogBackend, opened, settle, within } from "../test/catalog";
import { takeLink } from "./live";
import { JoinDialog } from "./LiveDialogs";

/** A link the platform opened Studio by, of an invitation. */
const LINK: LinkOpened = {
  kind: "invitation",
  link: {
    link: "turborel-studio://join?code=abc",
    session: "0f".repeat(16),
    fingerprint: "AB".repeat(32),
    direct: ["192.0.2.7:4500"],
    relay: "relay.example:4433",
    expires: 1_900_000_000,
  },
};

describe("an invitation's link", () => {
  it("opens the join dialog filled in, showing what it holds, and joins only on Join [DESIGN] D66", async () => {
    const asked = catalogBackend({ live_join: () => ({ hosted: null, joined: null }) });
    const store = await opened();
    act(() => {
      told(store, { kind: "liveLink", opened: LINK });
    });
    expect(store.current().dialog).toEqual({ kind: "liveJoin", opened: LINK });
    within(store, <JoinDialog opened={LINK} />);
    const holds = screen.getByRole("region", { name: "What the link holds" }).textContent;
    expect(holds).toContain("0f".repeat(16));
    expect(holds).toContain("192.0.2.7:4500, relay relay.example:4433");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Invitation" }).value).toBe(LINK.link.link);
    await settle();
    expect(asked.some((a) => a.command === "live_join")).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join" }));
      await settle();
    });
    expect(asked.find((a) => a.command === "live_join")?.args).toEqual({ code: LINK.link.link });
  });

  it("is refused, saying why, of an invitation expired or of none, and is taken as Studio starts [DESIGN] D66", async () => {
    const refused: LinkOpened = { kind: "refused", why: "the invitation has expired: ask for another" };
    let waiting: LinkOpened | null = refused;
    catalogBackend({
      take_live_link: () => {
        const taken = waiting;
        waiting = null;
        return taken;
      },
    });
    const store = await opened();
    await takeLink(store);
    expect(store.current().dialog).toEqual({ kind: "liveJoin", opened: refused });
    await takeLink(store);
    within(store, <JoinDialog opened={refused} />);
    expect(screen.getByText("The link is refused: the invitation has expired: ask for another.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Join" }).disabled).toBe(true);
  });
});
