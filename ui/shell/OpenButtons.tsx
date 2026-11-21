/**
 * The buttons that open what Studio works on (RULES.md D28, D59): a
 * server's connection, an embedded database opened or made, or one in
 * memory, as the explorer and the welcome panel show them.
 */
import { newInMemory, show } from "../state/actions";
import { type Store, useStore } from "../state/store";
import { Icon, type IconName } from "../icons/Icon";

/** Each button: its icon, its label, and what it does. */
const BUTTONS: readonly (readonly [IconName, string, (store: Store) => void])[] = [
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

/** The buttons, each of class `className` if given. */
export function OpenButtons({ className }: { readonly className?: string }) {
  const store = useStore();
  return (
    <>
      {BUTTONS.map(([icon, label, run]) => (
        <button
          key={label}
          type="button"
          className={className}
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
