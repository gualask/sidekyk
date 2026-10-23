//! The projects Sidekyk knows, which one is on screen, and how the list changes. Pure
//! bookkeeping: opening, watching and storing the projects belong to the layers around it.

mod contracts;
mod list;
mod place;

pub use contracts::{
    FolderChoice, Location, Project, ProjectList, ProjectsChangedEvent, Relocation, TilesLayout,
    PROJECTS_CHANGED_EVENT,
};
pub use place::{same_distro, FoundFolder};
