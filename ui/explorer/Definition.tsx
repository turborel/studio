/**
 * An object's definition as SQL (RULES.md D33): what Studio writes of it,
 * or a table scripted as one of its statements, shown as text, copied, or
 * saved to a file the user chooses.
 */
import { useEffect, useState } from "react";
import { catalogDefinition, type DefinitionOf, saveTextFile, type ScriptAs } from "../ipc/catalog";
import { isStudioError } from "../state/actions";
import { useStore } from "../state/store";
import { openWorksheet } from "../state/worksheets";

/** The statements a table is scripted as, in order, with their names. */
export const SCRIPTS: readonly (readonly [ScriptAs, string])[] = [
  ["create", "CREATE"],
  ["alter", "ALTER"],
  ["drop", "DROP"],
  ["select", "SELECT"],
  ["insert", "INSERT"],
  ["update", "UPDATE"],
  ["delete", "DELETE"],
];

/** The file a definition is saved to by default. */
function fileName(of: DefinitionOf): string {
  const name = "name" in of ? of.name : "specific" in of ? of.specific : of.schema;
  return `${name}.sql`;
}

/** The text of the definition `key` names, read over connection `connection`: null until read. */
function useDefinition(connection: number, key: string): string | null {
  const [read, setRead] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    let current = true;
    const told = (text: string) => {
      if (current) {
        setRead({ key, text });
      }
    };
    catalogDefinition(connection, JSON.parse(key) as DefinitionOf).then(told, (thrown: unknown) => {
      told(`-- ${isStudioError(thrown) ? thrown.message : String(thrown)}`);
    });
    return () => {
      current = false;
    };
  }, [connection, key]);
  return read?.key === key ? read.text : null;
}

/** The choice of the statement a table is scripted as. */
function ScriptChoice({ script, choose }: { script: ScriptAs; choose: (script: ScriptAs) => void }) {
  return (
    <label className="check">
      <span>Script as</span>
      <select
        value={script}
        onChange={(e) => {
          choose(e.target.value as ScriptAs);
        }}
      >
        {SCRIPTS.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The definition of `of`, read over connection `connection`. */
export function Definition({ connection, of }: { readonly connection: number; readonly of: DefinitionOf }) {
  const store = useStore();
  const [script, setScript] = useState<ScriptAs>("create");
  const [said, setSaid] = useState("");
  const asked: DefinitionOf = of.kind === "table" ? { ...of, script } : of;
  const text = useDefinition(connection, JSON.stringify(asked));
  const copy = async () => {
    await navigator.clipboard.writeText(text ?? "");
    setSaid("Copied.");
  };
  const saveIt = async () => {
    const path = await saveTextFile(fileName(of), text ?? "");
    setSaid(path === null ? "" : `Saved to ${path}.`);
  };
  return (
    <div className="definition">
      <div className="definition-bar">
        {of.kind === "table" && <ScriptChoice script={script} choose={setScript} />}
        <button type="button" disabled={text === null} onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" disabled={text === null} onClick={() => void saveIt()}>
          Save…
        </button>
        <button
          type="button"
          disabled={text === null}
          onClick={() => {
            openWorksheet(store, text ?? "", fileName(of));
          }}
        >
          Open in Worksheet
        </button>
        <span className="hint" role="status">
          {said}
        </span>
      </div>
      <pre className="definition-text" aria-label="Definition">
        {text ?? "Reading…"}
      </pre>
    </div>
  );
}
