//! The assistant's tools run on a connection of its own (RULES.md D55):
//! opened as the connection is, or as the assistant's own login where the
//! policy names one, each transaction begun READ ONLY, each statement
//! cancelled past the policy's time; so the database refuses what Studio's
//! checks might miss. What is hidden is never named to the model; a query
//! runs only once the user approves it, and returns at most the policy's
//! rows; SQL proposed is drafted for the user, never run.

use std::fmt::Write as _;

use serde_json::{Map, Value, json};

use crate::assistant::context::rows_text;
use crate::assistant::policy::{ConnectionPolicy, Use, Verdict, judge};
use crate::assistant::tools::text;
use crate::assistant::turn::{Host, Question, ToolOutcome, Toolbox, TurnEvent};
use crate::catalog::Catalog;
use crate::connections::manager::{ConnectionManager, Opened, RunAnswer};
use crate::connections::outcome::Outcome;
use crate::error::Result;
use crate::events::ConnectionId;
use crate::guard::classify::Class;
use crate::guard::policy::Guards;
use crate::saved::Environment;
use crate::saved::SavedConnection;
use crate::secret::Secret;

/// Opens the assistant's own connection of saved connection `saved`: as
/// its user, proving `password`, or as `login`, proving its password,
/// where the policy names one; each transaction begun READ ONLY, each
/// statement cancelled past `policy`'s seconds.
///
/// # Errors
///
/// The connection's failure, as turborel-client gives it.
pub fn open_session(
    manager: &ConnectionManager,
    saved: &SavedConnection,
    (password, login): (Option<&Secret>, Option<(&str, Option<&Secret>)>),
    policy: &ConnectionPolicy,
) -> Result<Opened> {
    let mut spec = saved.spec.clone();
    let password = match login {
        Some((user, secret)) => {
            spec.user = Some(user.to_owned());
            secret
        }
        None => password,
    };
    let guards = Guards { environment: saved.environment, read_only: true };
    let opened = manager.open((&spec, guards), password, |name| std::env::var(name).ok())?;
    let timeout = format!("SET STATEMENT.TIMEOUT_MS = {}", u64::from(policy.limits.statement_seconds) * 1000);
    if let Err(e) = manager.run(opened.connection, &timeout, true) {
        let _ = manager.close(opened.connection); // Its failure is the one told.
        return Err(e);
    }
    Ok(opened)
}

/// A query's columns' names, its rows, and whether they were cut short.
type Rows = (Vec<String>, Vec<Vec<Option<String>>>, bool);

/// The tools, on the assistant's connection `connection` of `manager`,
/// under `policy`, of a connection of `environment` whose schema is `schema`.
pub struct SessionTools<'a> {
    /// The connections.
    pub manager: &'a ConnectionManager,
    /// The assistant's own.
    pub connection: ConnectionId,
    /// Its policy.
    pub policy: &'a ConnectionPolicy,
    /// Its environment.
    pub environment: Environment,
    /// Its session's schema, which names written alone are of.
    pub schema: Option<String>,
}

/// An outcome the model is told of `content`, a success.
fn told(content: String, outcome: &str) -> ToolOutcome {
    ToolOutcome { content, is_error: false, outcome: outcome.to_owned() }
}

/// An outcome of a failure, `why`.
fn refused(why: String, outcome: &str) -> ToolOutcome {
    ToolOutcome { content: why, is_error: true, outcome: outcome.to_owned() }
}

/// What a verdict that stopped a statement says, and its outcome.
fn stopped(verdict: &Verdict) -> ToolOutcome {
    let rule = verdict.rule.clone().unwrap_or_default();
    refused(format!("Blocked by the rule {rule}: {}.", verdict.why.clone().unwrap_or_default()), &format!("blocked: {rule}"))
}

impl SessionTools<'_> {
    /// Whether `schema`.`table`, or `schema` of none, is hidden.
    fn hidden(&self, schema: &str, table: Option<&str>) -> bool {
        self.policy.hidden.iter().any(|h| {
            let h = h.to_uppercase();
            let s = schema.to_uppercase();
            h == s || table.is_some_and(|t| h == format!("{s}.{}", t.to_uppercase()))
        })
    }

    /// The verdict of `sql`'s use `use_`.
    fn verdict(&self, use_: Use, sql: &str) -> Verdict {
        judge(self.policy, self.environment, (use_, self.schema.as_deref()), sql)
    }

    /// Runs `sql` on the assistant's connection: its rows, at most `max`,
    /// the result closed and the READ ONLY transaction it began ended,
    /// whether it ran or failed.
    fn rows(&self, sql: &str, max: u32) -> Result<Rows> {
        let read = self.read(sql, usize::try_from(max).unwrap_or(usize::MAX));
        let _ = self.manager.run(self.connection, "ROLLBACK", true); // Ends the READ ONLY transaction it began.
        read
    }

    /// The rows of `sql`, at most `max`, its result closed.
    fn read(&self, sql: &str, max: usize) -> Result<Rows> {
        let RunAnswer::Ran(ran) = self.manager.run(self.connection, sql, false)? else {
            return Err(crate::error::StudioError::misuse("[DESIGN] the guards asked of a query: it is not run"));
        };
        let Outcome::Rows { result, columns, page } = ran.outcome else { return Ok((Vec::new(), Vec::new(), true)) };
        let names = (1..).zip(&columns).map(|(n, c): (u32, _)| c.name.clone().unwrap_or_else(|| format!("({n})"))).collect();
        let mut rows = page.rows;
        let mut complete = page.complete;
        while !complete && rows.len() < max {
            let from = u64::try_from(rows.len()).unwrap_or(u64::MAX);
            let more = self.manager.rows(self.connection, result, (from, u32::try_from(max).unwrap_or(u32::MAX)))?;
            complete = more.complete;
            rows.extend(more.rows);
        }
        let cut = rows.len() > max || !complete;
        rows.truncate(max);
        let _ = self.manager.close_result(self.connection, result); // One already closed needs no closing.
        Ok((names, rows, cut))
    }

    /// The schemas the assistant may see.
    fn list_schemas(&self) -> Result<ToolOutcome> {
        let schemas = Catalog::of(self.manager, self.connection).schemas()?;
        let names: Vec<String> = schemas.into_iter().map(|s| s.name).filter(|n| !self.hidden(n, None)).collect();
        Ok(told(json!(names).to_string(), "ran"))
    }

    /// The tables and views of `schema` the assistant may see.
    fn list_tables(&self, schema: &str) -> Result<ToolOutcome> {
        if self.hidden(schema, None) {
            return Ok(refused(format!("{schema} is hidden from the assistant."), "blocked: HIDDEN"));
        }
        let objects = Catalog::of(self.manager, self.connection).objects(schema)?;
        let tables: Vec<Value> = objects
            .tables
            .into_iter()
            .filter(|t| !self.hidden(schema, Some(&t.name)))
            .map(|t| json!({"name": t.name, "kind": t.kind}))
            .collect();
        Ok(told(Value::Array(tables).to_string(), "ran"))
    }

    /// The description of `schema`.`table`.
    fn describe(&self, schema: &str, table: &str) -> Result<ToolOutcome> {
        if self.hidden(schema, Some(table)) {
            return Ok(refused(format!("{schema}.{table} is hidden from the assistant."), "blocked: HIDDEN"));
        }
        let t = Catalog::of(self.manager, self.connection).table(schema, table)?;
        let described = json!({
            "kind": t.kind,
            "columns": t.columns.iter().map(|c| json!({"name": c.name, "type": c.type_written, "nullable": c.nullable, "default": c.default})).collect::<Vec<_>>(),
            "constraints": t.constraints.iter().map(|c| json!({"name": c.name, "kind": c.kind, "columns": c.columns, "check": c.check,
                "references": c.references.as_ref().map(|r| format!("{}.{} ({})", r.schema, r.table, r.columns.join(", ")))})).collect::<Vec<_>>(),
            "indexes": t.indexes.iter().map(|i| json!({"name": i.name, "method": i.method, "unique": i.unique, "columns": i.columns})).collect::<Vec<_>>(),
        });
        Ok(told(described.to_string(), "ran"))
    }

    /// EXPLAIN of `sql`, as its plan's text.
    fn explain(&self, sql: &str) -> Result<ToolOutcome> {
        let verdict = self.verdict(Use::Explain, sql);
        if !verdict.allowed {
            return Ok(stopped(&verdict));
        }
        let (_, rows, _) = self.rows(&format!("EXPLAIN {sql}"), 10_000)?;
        let plan: Vec<String> = rows.into_iter().filter_map(|r| r.into_iter().next().flatten()).collect();
        Ok(told(plan.join("\n"), "ran"))
    }

    /// The analyzer's findings of `schema`.
    fn findings(&self, schema: &str) -> Result<ToolOutcome> {
        if self.hidden(schema, None) {
            return Ok(refused(format!("{schema} is hidden from the assistant."), "blocked: HIDDEN"));
        }
        let analysis = Catalog::of(self.manager, self.connection).analysis(schema)?;
        let findings: Vec<Value> = analysis
            .findings
            .iter()
            .filter(|f| !self.policy.hidden.iter().any(|h| f.object.to_uppercase().contains(&h.to_uppercase())))
            .map(|f| json!({"rule": f.rule, "object": f.object, "says": f.says, "fix": f.fix}))
            .collect();
        Ok(told(Value::Array(findings).to_string(), "ran"))
    }

    /// Runs `sql` once the user approves it.
    fn run_query(&self, sql: &str, purpose: &str, host: &dyn Host) -> Result<ToolOutcome> {
        let verdict = self.verdict(Use::Run, sql);
        if !verdict.allowed {
            return Ok(stopped(&verdict));
        }
        let estimate = self.estimate(sql, &verdict);
        if !host.ask(Question::Run { sql: sql.to_owned(), purpose: purpose.to_owned(), verdict, estimate }) {
            return Ok(refused("The user did not approve running the query.".to_owned(), "refused by the user"));
        }
        let (columns, rows, cut) = self.rows(sql, self.policy.limits.rows)?;
        let mut content = rows_text(&columns, &rows);
        if cut {
            let _ = write!(content, "\n(the first {} rows alone)", self.policy.limits.rows); // A String takes every write.
        }
        Ok(told(content, "approved"))
    }

    /// EXPLAIN's estimate of query `sql`, judged `verdict`: the top line of
    /// its physical plan. None of more than one statement, of a statement
    /// not a query, as EXPLAIN plans queries alone, or of one EXPLAIN refuses.
    fn estimate(&self, sql: &str, verdict: &Verdict) -> Option<String> {
        if verdict.class != Class::Read || verdict.statements.len() != 1 {
            return None;
        }
        let (_, rows, _) = self.rows(&format!("EXPLAIN {sql}"), 10_000).ok()?;
        let lines: Vec<String> = rows.into_iter().filter_map(|r| r.into_iter().next().flatten()).collect();
        let physical = lines.iter().position(|l| l.trim() == "-- physical:")?;
        lines.get(physical.checked_add(1)?).map(|l| l.trim().to_owned())
    }

    /// Drafts `sql` for the user.
    fn propose(&self, input: &Map<String, Value>, host: &dyn Host) -> ToolOutcome {
        let sql = text(input, "sql");
        let verdict = self.verdict(Use::Propose, sql);
        if !verdict.allowed {
            return stopped(&verdict);
        }
        let blocked = verdict.blocked;
        let estimate = self.estimate(sql, &verdict);
        host.tell(TurnEvent::Draft {
            sql: sql.to_owned(),
            title: text(input, "title").to_owned(),
            why: text(input, "why").to_owned(),
            verdict,
            estimate,
        });
        let note =
            if blocked { " It is marked blocked for the assistant: the user alone may run it, typing its object's name." } else { "" };
        told(format!("Drafted into a worksheet for the user, who reads and runs it; it was not run.{note}"), "drafted")
    }
}

impl Toolbox for SessionTools<'_> {
    fn call(&self, name: &str, input: &Map<String, Value>, host: &dyn Host) -> ToolOutcome {
        let done = match name {
            "list_schemas" => self.list_schemas(),
            "list_tables" => self.list_tables(text(input, "schema")),
            "describe_table" => self.describe(text(input, "schema"), text(input, "table")),
            "explain" => self.explain(text(input, "sql")),
            "analyzer_findings" => self.findings(text(input, "schema")),
            "run_query" => self.run_query(text(input, "sql"), text(input, "purpose"), host),
            "propose_sql" => Ok(self.propose(input, host)),
            other => Ok(refused(format!("No tool is named {other}."), "input that did not fit")),
        };
        done.unwrap_or_else(|e| refused(format!("{}: {}", e.sqlstate, e.message), "failed"))
    }
}
