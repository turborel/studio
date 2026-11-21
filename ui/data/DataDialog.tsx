/**
 * The dialog of a task of data and definitions (RULES.md D42 to D45), by
 * the task's kind.
 */
import { EditRowsDialog, ExportDialog } from "./TableTasks";
import { ImportDialog } from "./ImportDialog";
import type { DataTask } from "./tasks";

/** The dialog of `task`. */
export function DataDialog({ task }: { readonly task: DataTask }) {
  switch (task.kind) {
    case "editRows":
      return <EditRowsDialog of={task} />;
    case "import":
      return <ImportDialog of={task} />;
    case "export":
      return <ExportDialog of={task} />;
    case "compare":
    case "alterTable":
    case "createTable":
      return null;
  }
}
