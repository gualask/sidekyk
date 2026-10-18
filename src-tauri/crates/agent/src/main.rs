//! `sidekyk-agent`: runs where the repositories are (a WSL distro) and answers the app over its
//! stdin and stdout (`docs/plans/remote-projects.md`). `version` prints its version, which names
//! the binary the app installs; `serve` answers until the app closes stdin. It logs on stderr,
//! which the app writes to its own log.

use std::process::ExitCode;
use std::sync::Arc;

use sidekyk_core::infrastructure::agent::serve;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::repositories::LocalRepositories;

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Some("serve") => {
            tracing_subscriber::fmt()
                .with_writer(std::io::stderr)
                // the app's log has the time; the level comes first, for the app to read it
                .without_time()
                .with_target(false)
                .with_max_level(tracing::Level::DEBUG)
                .init();
            let repositories = LocalRepositories::new(
                Arc::new(LocalRepositoryBackend::default()),
                Arc::new(LocalRepositoryWatcher),
            );
            match serve(repositories, std::io::stdin(), std::io::stdout()) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    tracing::error!(error = %format!("{error:#}"), "stopped serving");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("usage: sidekyk-agent version | serve");
            ExitCode::from(2)
        }
    }
}
