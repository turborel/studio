//! A result's rows, a page at a time (RULES.md R-SAFE-1, D25): each batch
//! a cursor's fetch gives is a page, spooled as it comes, the latest few
//! kept in memory; rows asked for past those read are fetched first.

use std::collections::VecDeque;
use std::sync::Arc;

use serde::Serialize;
use turborel::storage::Row;

use crate::connections::cells::{Cell, cells};
use crate::connections::spool::Spool;
use crate::error::{Result, StudioError};

/// The rows a cursor's fetch asks for, one page (CONFORMANCE.md S-IMPL-1).
pub const PAGE_ROWS: u32 = 500;
/// The pages a result keeps in memory; the rest are read from its spool
/// (S-LIMIT-1).
pub const CACHED_PAGES: usize = 8;
/// The most rows one request for rows may ask for (R-SEC-6).
pub const MAX_ROWS_ASKED: u32 = 10_000;

/// Rows of a result, from a place in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// The place of its first row in the result, from 0.
    pub from: u64,
    /// Its rows' cells.
    pub rows: Vec<Vec<Cell>>,
    /// The rows read of the result so far.
    pub rows_read: u64,
    /// Whether every row has been read, so `rows_read` is the result's.
    pub complete: bool,
}

/// What gives a result's next batch: its rows, and whether more follow.
pub type Next<'a> = &'a mut dyn FnMut() -> Result<(Vec<Row>, bool)>;

/// A result's pages.
#[derive(Debug)]
pub struct Pages {
    spool: Spool,
    /// Where each page begins, by row.
    starts: Vec<u64>,
    /// The latest pages read, by number, newest last.
    cache: VecDeque<(usize, Arc<Vec<Vec<Cell>>>)>,
    rows_read: u64,
    complete: bool,
}

impl Pages {
    /// The pages of a result whose first batch is `first`, `more` if the
    /// cursor has more, spooled in `dir`.
    ///
    /// # Errors
    ///
    /// The spool's.
    pub fn new(dir: &std::path::Path, first: &[Row], more: bool) -> Result<Pages> {
        let mut pages = Pages { spool: Spool::new(dir)?, starts: Vec::new(), cache: VecDeque::new(), rows_read: 0, complete: !more };
        pages.add(first, more)?;
        Ok(pages)
    }

    /// Adds a batch of rows as the next page.
    fn add(&mut self, rows: &[Row], more: bool) -> Result<()> {
        let page: Vec<Vec<Cell>> = rows.iter().map(cells).collect();
        let bytes = serde_json::to_vec(&page).map_err(|e| StudioError::misuse(format!("[DESIGN] a page cannot be kept: {e}")))?;
        let number = self.spool.append(&bytes)?;
        self.starts.push(self.rows_read);
        self.rows_read = self.rows_read.saturating_add(u64::try_from(page.len()).unwrap_or(u64::MAX));
        self.complete = !more;
        self.remember(number, Arc::new(page));
        Ok(())
    }

    /// Keeps page `number` among the latest, the oldest let go.
    fn remember(&mut self, number: usize, page: Arc<Vec<Vec<Cell>>>) {
        self.cache.retain(|(n, _)| *n != number);
        self.cache.push_back((number, page));
        while self.cache.len() > CACHED_PAGES {
            self.cache.pop_front();
        }
    }

    /// Page `number`'s rows, from memory or the spool.
    fn page(&mut self, number: usize) -> Result<Arc<Vec<Vec<Cell>>>> {
        if let Some((_, page)) = self.cache.iter().find(|(n, _)| *n == number) {
            return Ok(Arc::clone(page));
        }
        let bytes = self.spool.read(number)?;
        let page: Vec<Vec<Cell>> =
            serde_json::from_slice(&bytes).map_err(|e| StudioError::misuse(format!("[DESIGN] a page cannot be read: {e}")))?;
        let page = Arc::new(page);
        self.remember(number, Arc::clone(&page));
        Ok(page)
    }

    /// At most `count` rows from row `from`, fetching by `next` while the
    /// rows asked for are not yet read.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for more than `MAX_ROWS_ASKED`; the fetch's failure;
    /// the spool's.
    pub fn rows(&mut self, from: u64, count: u32, next: Next<'_>) -> Result<Page> {
        if count > MAX_ROWS_ASKED {
            return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_ROWS_ASKED} rows are asked for at once")));
        }
        let until = from.saturating_add(u64::from(count));
        while self.rows_read < until && !self.complete {
            let (rows, more) = next()?;
            self.add(&rows, more)?;
        }
        let mut found = Vec::new();
        let first = self.starts.partition_point(|start| *start <= from).saturating_sub(1);
        for number in first..self.starts.len() {
            let start = self.starts.get(number).copied().unwrap_or(u64::MAX);
            if start >= until {
                break;
            }
            let page = self.page(number)?;
            let skip = usize::try_from(from.saturating_sub(start)).unwrap_or(usize::MAX);
            let wanted = usize::try_from(until.saturating_sub(start.max(from))).unwrap_or(usize::MAX);
            found.extend(page.iter().skip(skip).take(wanted).cloned());
        }
        Ok(Page { from, rows: found, rows_read: self.rows_read, complete: self.complete })
    }

    /// The rows read so far, and whether they are all.
    pub fn read(&self) -> (u64, bool) {
        (self.rows_read, self.complete)
    }
}

#[cfg(test)]
mod tests;
