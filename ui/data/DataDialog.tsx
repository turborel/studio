/**
 * The dialog of a task of data and definitions (RULES.md D42 to D45), by
 * the task's kind.
 */
import { EditRowsDialog, ExportDialog } from "./TableTasks";
import { CompareDialog } from "./CompareDialog";
import { GenerateDialog } from "./GenerateDialog";
import { ImportDialog } from "./ImportDialog";
import { AlterTableDialog, CreateTableDialog } from "./TableDialogs";
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
    case "alterTable":
      return <AlterTableDialog of={task} />;
    case "createTable":
      return <CreateTableDialog connection={task.connection} schema={task.schema} />;
    case "compare":
      return <CompareDialog of={task} />;
    case "generate":
      return <GenerateDialog connection={task.connection} schema={task.schema} />;
  }
}
