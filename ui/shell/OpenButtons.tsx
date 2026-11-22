/**
 * The buttons that open what Studio works on (RULES.md D28, D59): a
 * server's connection, an embedded database opened or made, or one in
 * memory: as the Start panel's labelled cards, and as the explorer's
 * toolbar's icons.
 */
import { newInMemory, show } from "../state/actions";
import { type Store, useStore } from "../state/store";
import { Icon, type IconName } from "../icons/Icon";

/** Each button: its icon, its label, and what it does. */
export const OPEN_BUTTONS: readonly (readonly [IconName, string, (store: Store) => void])[] = [
  [
    "newConnection",
    "New Connection…",
    (store) => {
      show(store, { kind: "connection", editing: null });
    },
  ],
  [
    "openDatabase",
    "Open Database…",
    (store) => {
      show(store, { kind: "embedded", mode: "open", editing: null });
    },
  ],
  [
    "newDatabase",
    "New Database…",
    (store) => {
      show(store, { kind: "embedded", mode: "new", editing: null });
    },
  ],
  ["inMemory", "New In-Memory Database", (store) => void newInMemory(store)],
];

/** The buttons, labelled, as the Start panel's cards. */
export function OpenButtons() {
  const store = useStore();
  return (
    <>
      {OPEN_BUTTONS.map(([icon, label, run]) => (
        <button
          key={label}
          type="button"
          className="welcome-card"
          onClick={() => {
            run(store);
          }}
        >
          <Icon name={icon} />
          {label}
        </button>
      ))}
    </>
  );
}
