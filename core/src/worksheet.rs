//! What a worksheet needs of the backend (RULES.md D36): its script split
//! into statements, each with its place and class; the history of what
//! ran; and the worksheets and favourite queries kept between sessions.

pub mod files;
pub mod folders;
pub mod history;
pub mod scope;
pub mod script;
