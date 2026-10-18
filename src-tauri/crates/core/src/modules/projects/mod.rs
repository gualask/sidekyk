//! The repositories Sidekyk knows, which one is on screen, and how the list changes. Pure
//! bookkeeping: opening, watching and storing the projects belong to the layers around it.

mod contracts;
mod list;

pub use contracts::{
    ProjectList, ProjectsChangedEvent, TilesLayout, PROJECTS_CHANGED_EVENT,
};
