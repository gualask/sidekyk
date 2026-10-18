//! The helper (`sidekyk-agent`) that runs `LocalRepositories` on the machine holding the
//! repositories, and the app's client to it (`docs/plans/remote-projects.md`).

mod client;
mod protocol;
mod server;

use std::process::Command;

pub use client::AgentRepositories;
pub use server::serve;

/// The helper beside this process's binary, to serve: as a dev build of the app runs it for
/// local projects (`SIDEKYK_AGENT=local`).
pub fn helper_beside_this_binary() -> Command {
    let name = format!("sidekyk-agent{}", std::env::consts::EXE_SUFFIX);
    let binary = std::env::current_exe()
        .map(|this| this.with_file_name(&name))
        .unwrap_or_else(|_| name.into());
    let mut command = Command::new(binary);
    command.arg("serve");
    command
}
