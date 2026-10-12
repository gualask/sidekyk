//! The repositories Sidekyk knows, which one is on screen, and how the list changes. Pure
//! bookkeeping: opening, watching and storing the projects belong to the layers around it.

mod contracts;
mod list;

pub(crate) use contracts::{ProjectList, ProjectsChangedEvent, PROJECTS_CHANGED_EVENT};
