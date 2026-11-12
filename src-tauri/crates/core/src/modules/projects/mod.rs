//! The projects Sidekyk knows, which one is on screen, and how the list changes. Pure
//! bookkeeping: opening, watching and storing the projects belong to the layers around it.

mod contracts;
mod list;
mod list_folders;
mod place;
mod stored;

pub use contracts::{
    FolderChange, FolderChoice, Location, Opened, Project, ProjectFolder, ProjectList,
    ProjectsChangedEvent, TilesLayout, PROJECTS_CHANGED_EVENT,
};
pub use place::{same_distro, FoundFolder, NameCase};
