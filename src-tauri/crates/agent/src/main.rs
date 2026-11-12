//! `sidekyk-agent`: runs where the repositories are (a WSL distro) and answers the app over its
//! stdin and stdout (`docs/features/wsl.md`). `version` prints its version: the app runs
//! it to know the helper runs before it starts one; `serve` removes the older ones installed
//! beside it and answers until the app closes stdin. It logs on stderr, which the app writes to
//! its own log.

mod older;

use std::process::ExitCode;
use std::sync::Arc;

use sidekyk_core::infrastructure::agent::serve;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::reader::LocalRepositories;

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Some("serve") => serve_app(),
        _ => {
            eprintln!("usage: sidekyk-agent version | serve");
            ExitCode::from(2)
        }
    }
}

/// `serve`: logs on stderr, removes the older helpers, then answers the app until it closes stdin.
fn serve_app() -> ExitCode {
    log_to_stderr();
    if let Err(error) = std::env::current_exe().and_then(|this| older::remove_other_helpers(&this))
    {
        tracing::warn!(%error, "could not remove older helpers");
    }
    let repositories = LocalRepositories::new(
        Arc::new(LocalRepositoryBackend::default()),
        Arc::new(LocalRepositoryWatcher::default()),
    );
    match serve(repositories, std::io::stdin(), std::io::stdout()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = %format!("{error:#}"), "stopped serving");
            ExitCode::FAILURE
        }
    }
}

/// Every event from `debug` on stderr, which the app writes to its own log.
fn log_to_stderr() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        // the app's log has the time; the level comes first, for the app to read it
        .without_time()
        .with_target(false)
        .with_max_level(tracing::Level::DEBUG)
        .init();
}
