/**
 * The monitor's plug-ins (RULES.md D59): those Studio gave an embedded
 * database as it opened it, as `turboreld` gives them, and those it did
 * not, each with why; a server's are its operator's.
 */
import { type ReactNode, useEffect, useState } from "react";
import { type EmbeddedInfo, embeddedInfo } from "../ipc/embedded";
import { isStudioError } from "../state/actions";

/** The plug-ins' table: each plug-in, what it gives, whether it is loaded, and why. */
function PlugInTable({ plugIns }: { readonly plugIns: EmbeddedInfo["plugIns"] }) {
  return (
    <div className="monitor-table">
      <table className="details-table" aria-label="Plug-ins">
        <thead>
          <tr>
            <th scope="col">Plug-in</th>
            <th scope="col">Gives</th>
            <th scope="col">Loaded</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {plugIns.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.kind}</td>
              <td>{p.loaded ? "Yes" : "No"}</td>
              <td>{p.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the embedded database of `connection` was given: none of a server's, or why it was not read. */
function useEmbeddedInfo(connection: number): EmbeddedInfo | null | string {
  const [info, setInfo] = useState<EmbeddedInfo | null | string>("");
  useEffect(() => {
    let current = true;
    embeddedInfo(connection).then(
      (got) => {
        if (current) {
          setInfo(got);
        }
      },
      (thrown: unknown) => {
        if (current) {
          setInfo(isStudioError(thrown) ? thrown.message : String(thrown));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [connection]);
  return info;
}

/** The plug-ins an embedded database was given, and those it was not, and why (RULES.md D59); then `children`, the extensions. */
export function PlugIns({ connection, children }: { readonly connection: number; readonly children: ReactNode }) {
  const info = useEmbeddedInfo(connection);
  const given =
    info === "" ? (
      <p className="hint">Reading…</p>
    ) : typeof info === "string" ? (
      <p className="error">{info}</p>
    ) : info === null ? (
      <p className="hint">A server registers its own plug-ins, as its operator started it: its extensions are below.</p>
    ) : (
      <PlugInTable plugIns={info.plugIns} />
    );
  return (
    <>
      {given}
      {children}
    </>
  );
}
