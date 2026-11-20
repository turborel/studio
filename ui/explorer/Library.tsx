/**
 * The explorer's favourite queries and project folders (RULES.md D36):
 * each query opened in a worksheet, or forgotten; each project's `.sql`
 * files listed, each opened in a worksheet.
 */
import { useEffect, useState } from "react";
import { addProjectFolder, forgetQuery, projectFiles, removeProjectFolder } from "../ipc/worksheet";
import { isStudioError } from "../state/actions";
import { type Store, useStore, useStudio } from "../state/store";
import { openWorksheet } from "../state/worksheets";
import { openPath } from "../worksheet/commands";
import { Icon } from "../icons/Icon";

/** Runs `work`, keeping its failure as the error shown. */
async function kept(store: Store, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
  }
}

/** The favourite queries. */
function Queries() {
  const store = useStore();
  const queries = useStudio((s) => s.queries);
  if (queries.length === 0) {
    return <p className="hint">None yet: Worksheet &gt; Add to Favourite Queries keeps one.</p>;
  }
  return (
    <ul className="library" aria-label="Favourite queries">
      {queries.map((q) => (
        <li key={q.id}>
          <button
            type="button"
            className="link with-icon"
            title={q.sql}
            onClick={() => openWorksheet(store, q.sql, q.name)}
          >
            <Icon name="favourite" />
            {q.name}
          </button>
          <button
            type="button"
            aria-label={`Forget ${q.name}`}
            onClick={() =>
              void kept(store, async () => {
                const queries = await forgetQuery(q.id);
                store.update((now) => ({ ...now, queries }));
              })
            }
          >
            Forget
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The `.sql` files of project folder `folder`, read as it is shown: null until read. */
function useFiles(folder: string): string[] | null {
  const [files, setFiles] = useState<string[] | null>(null);
  useEffect(() => {
    let current = true;
    projectFiles(folder).then(
      (found) => {
        if (current) {
          setFiles(found);
        }
      },
      () => {
        if (current) {
          setFiles([]);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [folder]);
  return files;
}

/** A project folder's `.sql` files. */
function Project({ folder }: { readonly folder: string }) {
  const store = useStore();
  const files = useFiles(folder);
  const name =
    folder
      .split(/[\\/]/u)
      .filter((p) => p !== "")
      .at(-1) ?? folder;
  const separator = folder.includes("\\") ? "\\" : "/";
  const close = () =>
    void kept(store, async () => {
      const projects = await removeProjectFolder(folder);
      store.update((now) => ({ ...now, projects }));
    });
  return (
    <details open>
      <summary title={folder} className="with-icon">
        <Icon name="folder" />
        {name}
      </summary>
      <button type="button" onClick={close}>
        Close Project
      </button>
      {files === null && <p className="hint">Reading…</p>}
      {files !== null && files.length === 0 && <p className="hint">No .sql files.</p>}
      <ul className="library" aria-label={`Files of ${name}`}>
        {(files ?? []).map((file) => (
          <li key={file}>
            <button
              type="button"
              className="link"
              onClick={() => void openPath(store, `${folder}${separator}${file.split("/").join(separator)}`)}
            >
              <Icon name="worksheet" />
              {file}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The project folders. */
function Projects() {
  const store = useStore();
  const projects = useStudio((s) => s.projects);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void kept(store, async () => {
            const folders = await addProjectFolder();
            if (folders !== null) {
              store.update((now) => ({ ...now, projects: folders }));
            }
          })
        }
      >
        Add Project Folder…
      </button>
      {projects.map((folder) => (
        <Project key={folder} folder={folder} />
      ))}
    </>
  );
}

/** The favourite queries and the project folders, each a section of the explorer. */
export function Library() {
  return (
    <>
      <details className="explorer-section">
        <summary>Favourite Queries</summary>
        <Queries />
      </details>
      <details className="explorer-section">
        <summary>Projects</summary>
        <Projects />
      </details>
    </>
  );
}
