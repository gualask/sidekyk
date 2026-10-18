//! Structured logs to a file, through `tracing`.
//!
//! Development builds log every git command, watcher batch and command duration, also to stderr.
//! Release builds compile everything below `info` out (`release_max_level_info`), so the hot
//! paths cost nothing, and keep only what helps to report a problem: startup, the repository
//! opened, failures and panics. Nothing is written while the app is idle.

use std::fs::File;
use std::io::{self, Write};
use std::path::Path;
use std::str::FromStr;
use std::sync::Mutex;

use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::prelude::*;

/// Overrides the level of Sidekyk's own events: `error`, `warn`, `info`, `debug` or `trace`.
/// Release builds stop at `info` whatever it says.
const LEVEL_VAR: &str = "SIDEKYK_LOG";

/// What a build logs, and where. Both profiles are compiled in every build, so a mistake in the
/// release one shows up in development too.
struct Profile {
    file: &'static str,
    previous_file: &'static str,
    level: LevelFilter,
    max_bytes: u64,
    /// Also write to stderr, next to the terminal running `pnpm tauri:dev`.
    stderr: bool,
}

const DEVELOPMENT: Profile = Profile {
    file: "sidekyk-dev.log",
    previous_file: "sidekyk-dev.previous.log",
    level: LevelFilter::DEBUG,
    max_bytes: 32 * 1024 * 1024,
    stderr: true,
};

const RELEASE: Profile = Profile {
    file: "sidekyk.log",
    previous_file: "sidekyk.previous.log",
    level: LevelFilter::INFO,
    max_bytes: 2 * 1024 * 1024,
    stderr: false,
};

const PROFILE: Profile = if cfg!(debug_assertions) {
    DEVELOPMENT
} else {
    RELEASE
};

/// A log file that stops growing at `limit` bytes, so a failure that repeats on every refresh
/// cannot fill the disk.
struct CappedFile {
    file: File,
    written: u64,
    limit: u64,
}

impl Write for CappedFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.written >= self.limit {
            // Reported as written, so tracing does not retry or complain.
            return Ok(buf.len());
        }
        self.written += buf.len() as u64;
        self.file.write_all(buf)?;
        if self.written >= self.limit {
            self.file
                .write_all(b"log size limit reached, later events are dropped\n")?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// The level from `SIDEKYK_LOG`, else the build's default.
fn level(value: Option<&str>) -> LevelFilter {
    value
        .and_then(|v| LevelFilter::from_str(v.trim()).ok())
        .unwrap_or(PROFILE.level)
}

/// Starts logging to `dir`, keeping the previous session's file next to the new one. Logging
/// is best effort: if the file cannot be created, the app runs without it.
pub(crate) fn init(dir: &Path) {
    let Ok(file) = open_session_file(dir) else {
        return;
    };
    let file = Mutex::new(CappedFile {
        file,
        written: 0,
        limit: PROFILE.max_bytes,
    });

    let level = level(std::env::var(LEVEL_VAR).ok().as_deref());
    // Sidekyk's own events at `level` (the app, its core, the lines of its helper); dependencies
    // (Tauri plugins) only when something is wrong.
    let filter = Targets::new()
        .with_default(LevelFilter::WARN)
        .with_target(env!("CARGO_CRATE_NAME"), level)
        .with_target("sidekyk_core", level)
        .with_target("helper", level);

    let writer = file.and(io::stderr.with_filter(|_| PROFILE.stderr));
    let layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        // The message names the event; module paths only make lines longer to read and paste.
        .with_target(false)
        .with_writer(writer);
    if tracing_subscriber::registry()
        .with(layer.with_filter(filter))
        .try_init()
        .is_err()
    {
        return;
    }

    log_panics();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
        "Sidekyk started"
    );
}

fn open_session_file(dir: &Path) -> io::Result<File> {
    std::fs::create_dir_all(dir)?;
    let current = dir.join(PROFILE.file);
    if current.exists() {
        let _ = std::fs::rename(&current, dir.join(PROFILE.previous_file));
    }
    File::create(current)
}

/// Records panics in the log, then lets the default hook print them as before.
fn log_panics() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        tracing::error!(%location, %payload, "panic");
        default_hook(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_level_comes_from_the_variable_or_the_build() {
        assert_eq!(level(Some("trace")), LevelFilter::TRACE);
        assert_eq!(level(Some(" warn ")), LevelFilter::WARN);
        assert_eq!(level(Some("loud")), PROFILE.level);
        assert_eq!(level(None), PROFILE.level);
    }

    #[test]
    fn the_file_stops_growing_at_its_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("capped.log");
        let mut capped = CappedFile {
            file: File::create(&path).unwrap(),
            written: 0,
            limit: 10,
        };
        assert_eq!(capped.write(b"0123456789A\n").unwrap(), 12);
        assert_eq!(capped.write(b"too late").unwrap(), 8);

        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.starts_with("0123456789A\nlog size limit reached"));
        assert!(!body.contains("too late"));
    }

    #[test]
    fn a_new_session_keeps_the_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PROFILE.file), "first session").unwrap();
        drop(open_session_file(dir.path()).unwrap());

        let previous = std::fs::read_to_string(dir.path().join(PROFILE.previous_file)).unwrap();
        assert_eq!(previous, "first session");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(PROFILE.file)).unwrap(),
            ""
        );
    }
}
