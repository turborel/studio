//! What a connection's guards make of a script (RULES.md D29, R-SEC-7,
//! R-SEC-8): a read-only connection refuses a statement that may write; a
//! production connection asks before one; a statement that destroys, or
//! one Studio cannot classify, which may hide one, asks first on every
//! connection. Asked once, the user's confirmation runs the script as it
//! was shown.

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::guard::classify::{Class, Classified, classify_script};
use crate::saved::Environment;

/// The SQLSTATE a read-only connection refuses a write with, as the
/// server refuses one in a READ ONLY transaction.
pub const READ_ONLY_REFUSAL: &str = "25006";
/// The SQLCODE of that refusal, Studio's own.
pub const READ_ONLY_SQLCODE: i32 = -910;

/// A connection's guards, as its saved connection says.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guards {
    /// Its environment.
    pub environment: Environment,
    /// Whether each of its transactions is begun READ ONLY.
    pub read_only: bool,
}

/// Why a script needs the user's confirmation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Confirm {
    /// The strictest class of its statements.
    pub class: Class,
    /// What each statement that destroys destroys.
    pub destroys: Vec<String>,
    /// The statements Studio cannot classify, which may hide what they do.
    pub unclassified: Vec<String>,
    /// Whether it may write on a production connection.
    pub production: bool,
}

impl Guards {
    /// What the guards make of `script`: `None` if it may run as it is, the
    /// reasons to ask first if it needs confirmation, or the refusal.
    ///
    /// # Errors
    ///
    /// SQLSTATE 25006 for a statement that may write, or that makes a
    /// transaction READ WRITE, on a read-only connection.
    pub fn judge(&self, script: &str) -> Result<Option<Confirm>> {
        let statements = classify_script(script);
        self.judge_classified(&statements)
    }

    /// As `judge`, of statements already classified.
    ///
    /// # Errors
    ///
    /// As `judge`'s.
    pub fn judge_classified(&self, statements: &[Classified]) -> Result<Option<Confirm>> {
        if let Some(connects) = statements.iter().find(|s| s.connects) {
            return Err(StudioError::misuse(format!(
                "[DESIGN] a connection of Studio's is bound to its own session: open another connection rather than {}",
                connects.text
            )));
        }
        if self.read_only
            && let Some(refused) = statements.iter().find(|s| s.class.writes() || s.read_write)
        {
            return Err(StudioError::new(
                READ_ONLY_SQLCODE,
                READ_ONLY_REFUSAL,
                format!("[DESIGN] the connection is read-only, and this may write ({:?}): {}", refused.class, refused.text),
            ));
        }
        let class = crate::guard::classify::strictest(statements);
        let destroys: Vec<String> = statements.iter().filter_map(|s| s.destroys.clone()).collect();
        let unclassified: Vec<String> = statements.iter().filter(|s| s.class == Class::Unclassified).map(|s| s.text.clone()).collect();
        let production = self.environment == Environment::Production && class.writes();
        let asks = production || !destroys.is_empty() || !unclassified.is_empty();
        Ok(asks.then_some(Confirm { class, destroys, unclassified, production }))
    }
}

#[cfg(test)]
mod tests {
    use super::{Guards, READ_ONLY_REFUSAL};
    use crate::guard::classify::Class;
    use crate::saved::Environment;

    /// [STUDIO Running statements]: CONNECT, SET CONNECTION and DISCONNECT
    /// are refused, as each connection is bound to its own session.
    #[test]
    fn connection_statements_are_refused() {
        let guards = Guards::default();
        for sql in ["CONNECT TO 'db'", "SET CONNECTION 'other'", "DISCONNECT CURRENT"] {
            assert_eq!(guards.judge(sql).unwrap_err().sqlstate, "TB910", "{sql}");
        }
        assert!(guards.judge("END CONNECTION 7").is_ok());
    }

    /// [RULE] R-SEC-8: a statement that destroys asks first on any
    /// connection, and one that does not runs as it is.
    #[test]
    fn a_destroying_statement_asks_first_everywhere() {
        let guards = Guards::default();
        assert_eq!(guards.judge("SELECT * FROM T").unwrap(), None);
        assert_eq!(guards.judge("DELETE FROM T WHERE ID = 1").unwrap(), None);
        let confirm = guards.judge("DELETE FROM T").unwrap().unwrap();
        assert_eq!(confirm.destroys, ["DELETE of every row of T, with no WHERE"]);
        assert!(!confirm.production);
        let hidden = guards.judge("EXECUTE IMMEDIATE 'DROP TABLE T CASCADE'").unwrap().unwrap();
        assert_eq!(hidden.unclassified, ["EXECUTE IMMEDIATE 'DROP TABLE T CASCADE'"]);
    }

    /// [RULE] R-SEC-7: a production connection asks before any statement
    /// that may write, and lets a read run.
    #[test]
    fn production_asks_before_a_write() {
        let guards = Guards { environment: Environment::Production, read_only: false };
        assert_eq!(guards.judge("SELECT 1 FROM T; COMMIT").unwrap(), None);
        let confirm = guards.judge("SELECT 1 FROM T; INSERT INTO T VALUES (1)").unwrap().unwrap();
        assert!(confirm.production);
        assert_eq!(confirm.class, Class::WriteRows);
    }

    /// [RULE] R-SEC-7: a read-only connection refuses a statement that may
    /// write, and one that makes the transaction READ WRITE, before it is
    /// sent.
    #[test]
    fn read_only_refuses_a_write() {
        let guards = Guards { environment: Environment::Development, read_only: true };
        assert_eq!(guards.judge("SELECT 1 FROM T").unwrap(), None);
        assert_eq!(guards.judge("SET TRANSACTION READ ONLY").unwrap(), None);
        assert_eq!(guards.judge("UPDATE T SET A = 1 WHERE B = 2").unwrap_err().sqlstate, READ_ONLY_REFUSAL);
        assert_eq!(guards.judge("SET TRANSACTION READ WRITE").unwrap_err().sqlstate, READ_ONLY_REFUSAL);
        assert_eq!(guards.judge("NOT SQL AT ALL").unwrap_err().sqlstate, READ_ONLY_REFUSAL);
    }
}
