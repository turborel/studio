import { mockBackend } from "../test/backend";
import * as ipc from "./worksheet";

describe("the worksheet's commands", () => {
  it("are each asked of the backend by its name, with its arguments [RULE] R-TS-3", async () => {
    const asked = mockBackend();
    const entry = { sql: "VALUES (1)", at: 1, connection: "X", saved: null, millis: 1, rows: null, sqlstate: "00000" };
    await ipc.sqlWords();
    await ipc.splitScript("VALUES (1)");
    await ipc.judgeScript(1, "VALUES (1)");
    await ipc.statementParameters(1, "VALUES (?)");
    await ipc.searchHistory("", 5);
    await ipc.recordHistory(entry);
    await ipc.clearHistory();
    await ipc.loadWorksheets();
    await ipc.keepWorksheets([]);
    await ipc.listQueries();
    await ipc.keepQuery({ id: "q", name: "Q", sql: "VALUES (1)" });
    await ipc.forgetQuery("q");
    await ipc.openSqlFile();
    await ipc.readSqlFile("/a.sql");
    await ipc.writeSqlFile("/a.sql", "x");
    await ipc.projectFolders();
    await ipc.addProjectFolder();
    await ipc.removeProjectFolder("/p");
    await ipc.projectFiles("/p");
    await ipc.notifyFinished("T", "B");
    expect(asked.map((a) => a.command)).toEqual([
      "sql_words",
      "split_script",
      "judge_script",
      "statement_parameters",
      "search_history",
      "record_history",
      "clear_history",
      "load_worksheets",
      "keep_worksheets",
      "list_queries",
      "keep_query",
      "forget_query",
      "open_sql_file",
      "read_sql_file",
      "write_sql_file",
      "project_folders",
      "add_project_folder",
      "remove_project_folder",
      "project_files",
      "notify_finished",
    ]);
    expect(asked[3]?.args).toEqual({ connection: 1, sql: "VALUES (?)" });
    expect(asked[14]?.args).toEqual({ path: "/a.sql", text: "x" });
  });
});
