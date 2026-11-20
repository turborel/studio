//! Paging a result, its batches made by the test.

#![allow(clippy::arithmetic_side_effects, reason = "the fixtures number a few rows")]

use turborel::storage::Row;
use turborel::value::{Decimal, Value};

use super::{CACHED_PAGES, MAX_ROWS_ASKED, Pages};
use crate::error::{Result, StudioError};

/// Rows numbered from `first`, `count` of them, of one column.
fn numbered(first: i128, count: i128) -> Vec<Row> {
    (first..first + count).map(|n| vec![Value::Exact(Decimal::new(n, 0))]).collect()
}

/// A cursor of `batches` batches of `size` rows, numbered from 0.
fn cursor(batches: i128, size: i128) -> impl FnMut() -> Result<(Vec<Row>, bool)> {
    let mut next = 1;
    move || {
        if next >= batches {
            return Err(StudioError::misuse("read past the end"));
        }
        let rows = numbered(next * size, size);
        next += 1;
        Ok((rows, next < batches))
    }
}

/// The first cell of each row of `page`.
fn firsts(page: &super::Page) -> Vec<String> {
    page.rows.iter().map(|r| r[0].clone().unwrap()).collect()
}

/// [RULE] R-SAFE-1: rows within the first batch are given with no fetch.
#[test]
fn rows_already_read_need_no_fetch() {
    let mut pages = Pages::new(&crate::testing::scratch("pages/first"), &numbered(0, 10), true).unwrap();
    let mut never = || -> Result<(Vec<Row>, bool)> { panic!("fetched") };
    let page = pages.rows(2, 3, &mut never).unwrap();
    assert_eq!(firsts(&page), ["2", "3", "4"]);
    assert_eq!((page.rows_read, page.complete), (10, false));
}

/// [RULE] R-SAFE-1: rows past those read are fetched, a batch at a time,
/// and a span across pages is joined.
#[test]
fn rows_past_those_read_are_fetched() {
    let mut pages = Pages::new(&crate::testing::scratch("pages/fetched"), &numbered(0, 10), true).unwrap();
    let mut next = cursor(4, 10);
    let page = pages.rows(18, 5, &mut next).unwrap();
    assert_eq!(firsts(&page), ["18", "19", "20", "21", "22"]);
    assert_eq!(pages.read(), (30, false));
}

/// [RULE] R-SAFE-1: past the last row, what there is is given, and the
/// result is complete.
#[test]
fn the_end_is_found() {
    let mut pages = Pages::new(&crate::testing::scratch("pages/end"), &numbered(0, 10), true).unwrap();
    let mut next = cursor(3, 10);
    let page = pages.rows(25, 100, &mut next).unwrap();
    assert_eq!(firsts(&page), ["25", "26", "27", "28", "29"]);
    assert!(page.complete);
    assert_eq!(pages.rows(40, 5, &mut next).unwrap().rows, Vec::<Vec<Option<String>>>::new());
}

/// [RULE] R-SAFE-1: pages no longer in memory are read back from the spool.
#[test]
fn old_pages_come_back_from_the_spool() {
    let batches = i128::try_from(CACHED_PAGES).unwrap() * 2;
    let mut pages = Pages::new(&crate::testing::scratch("pages/spooled"), &numbered(0, 10), true).unwrap();
    let mut next = cursor(batches, 10);
    pages.rows(0, MAX_ROWS_ASKED, &mut next).unwrap();
    assert_eq!(pages.cache.len(), CACHED_PAGES);
    assert_eq!(firsts(&pages.rows(3, 2, &mut next).unwrap()), ["3", "4"]);
}

/// [RULE] R-SEC-6: more rows than one request may ask for are refused.
#[test]
fn too_many_rows_asked_are_refused() {
    let mut pages = Pages::new(&crate::testing::scratch("pages/many"), &numbered(0, 1), false).unwrap();
    let mut never = || -> Result<(Vec<Row>, bool)> { panic!("fetched") };
    assert_eq!(pages.rows(0, MAX_ROWS_ASKED + 1, &mut never).unwrap_err().sqlstate, "TB910");
}
