//! The guards on what runs (RULES.md D29, R-SEC-7, R-SEC-8): each statement
//! classified by Turborel's own parser, and the confirmations and refusals
//! a connection's environment, its being read-only, and a statement that
//! destroys call for, on every path a statement takes.

pub mod classify;
pub mod policy;
