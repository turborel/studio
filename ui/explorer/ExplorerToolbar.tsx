/**
 * The explorer's toolbar (RULES.md D28, R-UI-1): a slim row of icons at
 * the top of the explorer, each named by its tooltip and its accessible
 * name: a new connection, an embedded database opened or made, or one in
 * memory; then the active connection's catalog read again, its search
 * shown or hidden, and its tree closed.
 */
import { OPEN_BUTTONS } from "../shell/OpenButtons";
import { collapseAll, loadSchemas, showSearch } from "../state/catalog";
import { useStore, useStudio } from "../state/store";
import { Icon } from "../icons/Icon";
import "./explorer.css";

/** A tool's name, the ellipsis of a dialog it opens dropped from its accessible name. */
const nameOf = (label: string): string => label.replace(/…$/, "");

/** The tools of the active connection's catalog: read again, searched, closed. */
function CatalogTools() {
  const store = useStore();
  const active = useStudio((s) => s.active);
  const searching = useStudio((s) => s.explorerSearch);
  return (
    <>
      <button
        type="button"
        className="tool"
        title="Refresh the catalog"
        aria-label="Refresh"
        disabled={active === null}
        onClick={() => {
          if (active !== null) {
            void loadSchemas(store, active);
          }
        }}
      >
        <Icon name="reconnect" />
      </button>
      <button
        type="button"
        className="tool"
        title="Filter the catalog"
        aria-label="Filter"
        aria-pressed={searching}
        disabled={active === null}
        onClick={() => {
          showSearch(store, !searching);
        }}
      >
        <Icon name="filter" />
      </button>
      <button
        type="button"
        className="tool"
        title="Collapse the catalog's tree"
        aria-label="Collapse All"
        disabled={active === null}
        onClick={() => {
          if (active !== null) {
            collapseAll(store, active);
          }
        }}
      >
        <Icon name="collapseAll" />
      </button>
    </>
  );
}

/** The explorer's toolbar. */
export function ExplorerToolbar() {
  const store = useStore();
  return (
    <div className="explorer-toolbar" role="toolbar" aria-label="Explorer">
      {OPEN_BUTTONS.map(([icon, label, run]) => (
        <button
          key={label}
          type="button"
          className="tool"
          title={label}
          aria-label={nameOf(label)}
          onClick={() => {
            run(store);
          }}
        >
          <Icon name={icon} />
        </button>
      ))}
      <span className="tool-separator" aria-hidden="true" />
      <CatalogTools />
    </div>
  );
}
