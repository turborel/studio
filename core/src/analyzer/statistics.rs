//! The analyzer's rules of the planner's statistics (RULES.md D72): a
//! table whose statistics have not been gathered, and one changed past
//! what its statistics were gathered of, by the share and the rows its
//! table options STATISTICS.REFRESH_FRACTION and STATISTICS.REFRESH_ROWS
//! say (Turborel's `appendix/g-table-options.md`), each judged of a table
//! a built-in engine keeps, whose statistics the views show
//! (`[DOC sql/07-information-schema.md Column statistics]`). No SQL
//! statement gathers them: the database's maintenance does, once a plan
//! has read them since they fell due, and reading them in
//! COLUMN_STATISTICS reads them as a plan does. So the fix reads them
//! there, or, while JOBS.POLICY keeps the maintenance from running, sets
//! it AUTOMATIC.

use crate::analyzer::{Finding, Setting};
use crate::catalog::model::TableDetail;
use crate::catalog::names::qualified;
use crate::catalog::statistics::TableStatistics;

/// A table of rows whose statistics have not been gathered.
pub const STATISTICS_MISSING: &str = "STATS-MISSING";
/// A table changed past what its statistics were gathered of.
pub const STATISTICS_STALE: &str = "STATS-STALE";

/// The engines Turborel builds in, whose statistics the views show; an
/// engine of a plug-in keeps its own, or none.
const BUILT_IN_ENGINES: [&str; 2] = ["rowstore", "columnstore"];
/// The setting of how the database's background work runs.
const JOBS_POLICY: &str = "JOBS.POLICY";
/// The policy under which the maintenance runs as its work comes due.
const AUTOMATIC: &str = "AUTOMATIC";
/// The table option of the share of its rows changed after which its
/// statistics are gathered again.
const REFRESH_FRACTION: &str = "STATISTICS.REFRESH_FRACTION";
/// The table option of the changes past that share after which they are.
const REFRESH_ROWS: &str = "STATISTICS.REFRESH_ROWS";
/// REFRESH_FRACTION's default, 0.1, as tenths.
const DEFAULT_FRACTION: (u128, u128) = (1, 10);
/// REFRESH_ROWS's default.
const DEFAULT_ROWS: u128 = 50;
/// The most digits after the point of a fraction read exactly.
const MAX_DECIMALS: usize = 18;
/// The base of a decimal fraction's digits.
const TEN: u128 = 10;

/// `text`, a decimal number of no sign, as a numerator and a power of ten
/// below it, read exactly (R-NUM-1); none if it is not one.
fn fraction(text: &str) -> Option<(u128, u128)> {
    let (whole, part) = text.trim().split_once('.').unwrap_or((text.trim(), ""));
    let digits = format!("{whole}{part}");
    if digits.is_empty() || part.len() > MAX_DECIMALS || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, TEN.checked_pow(u32::try_from(part.len()).ok()?)?))
}

/// The value of table option `name` of `t`, if set apart from its default.
fn option<'a>(t: &'a TableDetail, name: &str) -> Option<&'a str> {
    t.storage.as_ref()?.options.iter().find(|(o, _)| o == name).map(|(_, v)| v.as_str())
}

/// Whether `changed` rows are more than `t`'s refresh share of `gathered`
/// rows and its refresh rows more, as its engine judges them due.
fn past_refresh(t: &TableDetail, gathered: u128, changed: u128) -> bool {
    let (numerator, scale) = option(t, REFRESH_FRACTION).and_then(fraction).unwrap_or(DEFAULT_FRACTION);
    let rows = option(t, REFRESH_ROWS).and_then(|r| r.trim().parse().ok()).unwrap_or(DEFAULT_ROWS);
    // changed > gathered * numerator / scale + rows, multiplied through by scale.
    let threshold = gathered.checked_mul(numerator).and_then(|g| rows.checked_mul(scale).and_then(|r| g.checked_add(r)));
    threshold.is_some_and(|t| changed.checked_mul(scale).is_some_and(|c| c > t))
}

/// The fix of `table`'s statistics, of `schema` and `name`: JOBS.POLICY
/// set AUTOMATIC if `settings` hold it otherwise, else its statistics read
/// as a plan reads them, so the maintenance gathers them.
fn fix(settings: &[Setting], (schema, name): (&str, &str)) -> String {
    let policy = settings.iter().find(|s| s.name == JOBS_POLICY).map(|s| s.value.as_str());
    if policy.is_some_and(|p| !p.eq_ignore_ascii_case(AUTOMATIC)) {
        return format!("SET DATABASE {JOBS_POLICY} = '{AUTOMATIC}';");
    }
    let quoted = |s: &str| s.replace('\'', "''");
    format!(
        "SELECT COLUMN_NAME, ROW_COUNT, GATHERED FROM INFORMATION_SCHEMA.COLUMN_STATISTICS\n  WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}';",
        quoted(schema),
        quoted(name)
    )
}

/// STATS-MISSING and STATS-STALE of table `t`, of its statistics `s`.
pub fn statistics_findings(t: &TableDetail, s: &TableStatistics, settings: &[Setting]) -> Option<Finding> {
    let built_in = s.engine.as_deref().is_some_and(|e| BUILT_IN_ENGINES.contains(&e));
    let rows: u128 = s.rows.as_deref()?.trim().parse().ok()?;
    if !built_in || s.columns.is_empty() || rows == 0 || t.partitioning.is_some() {
        return None;
    }
    let table = qualified(&t.schema, &t.name);
    let waiting = match settings.iter().find(|x| x.name == JOBS_POLICY) {
        Some(p) if !p.value.eq_ignore_ascii_case(AUTOMATIC) => {
            format!(" {JOBS_POLICY} is {}, so the maintenance does not gather them until it is {AUTOMATIC}.", p.value)
        }
        _ => " Reading them, as this analysis did, asks for them, and the maintenance gathers them soon after.".to_owned(),
    };
    let fix = fix(settings, (&t.schema, &t.name));
    let Some(gathered) = s.gathered_rows.as_deref().and_then(|g| g.trim().parse::<u128>().ok()) else {
        return Some(Finding {
            rule: STATISTICS_MISSING,
            object: table.clone(),
            says: format!(
                "The planner's statistics of {table}, of {rows} rows, have not been gathered, so it estimates the rows of a query of it by its defaults.{waiting}"
            ),
            fix,
        });
    };
    let changed = rows.abs_diff(gathered);
    past_refresh(t, gathered, changed).then(|| Finding {
        rule: STATISTICS_STALE,
        object: table.clone(),
        says: format!(
            "The planner's statistics of {table} were gathered of {gathered} rows, and it holds {rows} now: more rows than its {REFRESH_FRACTION} of those and {REFRESH_ROWS} more, so the planner's estimates of it are off until they are gathered again.{waiting}"
        ),
        fix,
    })
}

#[cfg(test)]
mod tests {
    use super::{STATISTICS_MISSING, STATISTICS_STALE, fraction, past_refresh, statistics_findings};
    use crate::analyzer::Setting;
    use crate::catalog::model::{Storage, TableDetail};
    use crate::catalog::statistics::{ColumnStatistics, TableStatistics};

    /// Statistics of ANN.T: of `engine`, `rows` now, gathered of `gathered`.
    fn of(engine: &str, rows: &str, gathered: Option<&str>) -> TableStatistics {
        TableStatistics {
            schema: "ANN".to_owned(),
            table: "T".to_owned(),
            engine: Some(engine.to_owned()),
            rows: Some(rows.to_owned()),
            last_changed: None,
            gathered_rows: gathered.map(str::to_owned),
            gathered: None,
            columns: vec![ColumnStatistics {
                name: "A".to_owned(),
                null_fraction: None,
                distinct_values: None,
                average_width: None,
                min_value: None,
                max_value: None,
                most_common: None,
                frequencies: None,
                histogram: None,
            }],
            indexes: Vec::new(),
        }
    }

    /// JOBS.POLICY of `value`.
    fn policy(value: &str) -> Setting {
        Setting {
            name: "JOBS.POLICY".to_owned(),
            value: value.to_owned(),
            source: "DATABASE".to_owned(),
            default: "AUTOMATIC".to_owned(),
            takes_effect: "STATEMENT".to_owned(),
            description: String::new(),
        }
    }

    /// [DOC sql/07-information-schema.md Column statistics] [DESIGN] D72:
    /// statistics not gathered of a table of rows are missing, and ones
    /// gathered of far fewer rows than it holds stale; each fixed by reading
    /// them as a plan does, or, while the maintenance is paused, by setting
    /// JOBS.POLICY AUTOMATIC. A table of no rows, of a plug-in's engine, of
    /// no column shown, partitioned, or of fresh statistics has none.
    #[test]
    fn missing_and_stale_statistics_are_found() {
        let t = crate::analyzer::tests::bare_table();
        let missing = statistics_findings(&t, &of("rowstore", "1000", None), &[]).unwrap();
        assert_eq!(missing.rule, STATISTICS_MISSING);
        assert!(missing.fix.starts_with("SELECT COLUMN_NAME, ROW_COUNT, GATHERED FROM INFORMATION_SCHEMA.COLUMN_STATISTICS"));
        assert!(missing.fix.contains("TABLE_SCHEMA = 'ANN' AND TABLE_NAME = 'T'"));
        let stale = statistics_findings(&t, &of("columnstore", "2000", Some("1000")), &[policy("AUTOMATIC")]).unwrap();
        assert_eq!(stale.rule, STATISTICS_STALE);
        assert!(stale.says.contains("gathered of 1000 rows, and it holds 2000 now"), "{}", stale.says);
        let paused = statistics_findings(&t, &of("rowstore", "1000", None), &[policy("PAUSED")]).unwrap();
        assert_eq!(paused.fix, "SET DATABASE JOBS.POLICY = 'AUTOMATIC';");
        assert!(paused.says.contains("JOBS.POLICY is PAUSED"));
        assert!(statistics_findings(&t, &of("rowstore", "1100", Some("1000")), &[]).is_none());
        assert!(statistics_findings(&t, &of("rowstore", "0", None), &[]).is_none());
        assert!(statistics_findings(&t, &of("plugged", "1000", None), &[]).is_none());
        assert!(statistics_findings(&t, &TableStatistics { columns: Vec::new(), ..of("rowstore", "1000", None) }, &[]).is_none());
        assert!(statistics_findings(&t, &TableStatistics { rows: None, ..of("rowstore", "1000", None) }, &[]).is_none());
        let parted = TableDetail {
            partitioning: Some(crate::catalog::model::Partitioning {
                strategy: "RANGE".to_owned(),
                key: "A".to_owned(),
                partitions: Vec::new(),
            }),
            ..t
        };
        assert!(statistics_findings(&parted, &of("rowstore", "1000", None), &[]).is_none());
    }

    /// A table of no column, its storage's options `options`.
    fn table(options: &[(&str, &str)]) -> TableDetail {
        TableDetail {
            storage: Some(Storage {
                engine: "rowstore".to_owned(),
                options: options.iter().map(|(o, v)| ((*o).to_owned(), (*v).to_owned())).collect(),
            }),
            ..crate::analyzer::tests::bare_table()
        }
    }

    /// [DOC appendix/g-table-options.md] [DESIGN] D72: a share is read
    /// exactly, as tenths or a whole number; a sign, letters or too many
    /// digits are no share.
    #[test]
    fn a_share_is_read_exactly() {
        assert_eq!(fraction("0.1"), Some((1, 10)));
        assert_eq!(fraction("2"), Some((2, 1)));
        assert_eq!(fraction("0.25"), Some((25, 100)));
        assert_eq!(fraction("-0.1"), None);
        assert_eq!(fraction("x"), None);
        assert_eq!(fraction(""), None);
        assert_eq!(fraction(&format!("0.{}", "1".repeat(19))), None);
    }

    /// [DOC appendix/g-table-options.md] [DESIGN] D72: statistics are
    /// stale past the share and the rows of the defaults, 0.1 and 50, or of
    /// the table's own options: of 1,000 rows gathered, 150 changes are
    /// not past 0.1's 100 and 50, and 151 are.
    #[test]
    fn statistics_are_stale_past_the_tables_refresh() {
        let plain = table(&[]);
        assert!(!past_refresh(&plain, 1_000, 150));
        assert!(past_refresh(&plain, 1_000, 151));
        let own = table(&[("STATISTICS.REFRESH_FRACTION", "0.5"), ("STATISTICS.REFRESH_ROWS", "0")]);
        assert!(!past_refresh(&own, 1_000, 500));
        assert!(past_refresh(&own, 1_000, 501));
        assert!(!past_refresh(&plain, u128::MAX, 1));
    }
}
