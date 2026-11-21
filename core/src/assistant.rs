//! The assistant (RULES.md D55): a model of the user's choice, Claude or
//! their own, asked from the backend alone, never the webview; its guard
//! rails enforced in code; and a local log of what it was asked and did.

pub mod audit;
pub mod context;
pub mod http;
pub mod mock;
pub mod policy;
pub mod service;
pub mod settings;
pub mod toolbox;
pub mod tools;
pub mod turn;
pub mod wire;
