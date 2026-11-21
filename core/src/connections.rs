//! Connections to Turborel servers and embedded databases (RULES.md D24,
//! D59): their settings, the manager and its workers, statements run and
//! their results paged.

pub mod cells;
pub mod imports;
pub mod manager;
pub mod outcome;
pub mod pages;
pub mod scripted;
pub mod session;
pub mod spec;
pub mod spool;
pub mod values;
pub(crate) mod worker;
