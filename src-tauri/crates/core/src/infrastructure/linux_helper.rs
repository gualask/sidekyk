//! The helper installed and started on a Linux machine the app reaches only by starting processes
//! there: a WSL distro (`wsl.exe`), or a container (`docker exec`), as the container fixture is
//! (`docs/features/wsl.md`).

use std::hash::{DefaultHasher, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::Context;

use super::process;

/// Where the helper is installed, under the machine's user's home.
pub const SERVER_DIR: &str = ".sidekyk-server";
/// The machine may start first (a stopped WSL distro) before it runs anything.
const START_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_OUTPUT: usize = 64 * 1024;
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Writes the helper read from stdin, under a temporary name first, so a copy cut short is never
/// taken for the helper. `$1` the folder, `$2` the helper's name.
const STREAM: &str = r#"set -e; mkdir -p "$1"; tmp="$1/.$2.$$"; cat > "$tmp"; chmod 755 "$tmp"; mv -f "$tmp" "$1/$2""#;

/// A Linux machine the app reaches by starting a process there.
pub trait LinuxMachine: Send + Sync {
    /// How messages and the log name it.
    fn name(&self) -> &str;

    /// `program` started there from its user's home, with no shell, its arguments to add; a path
    /// from the home is found. Stdout and stderr piped.
    fn command(&self, program: &str) -> Command;

    /// A command that puts `file` (this machine's) at `<folder>/<name>` there, faster than
    /// through stdin, if the machine has one; it fails when it cannot, and stdin is used.
    fn copy(&self, _file: &Path, _folder: &str, _name: &str) -> Option<Command> {
        None
    }
}

/// The helper to install on Linux machines: this machine's copy of it.
pub struct LinuxHelper {
    file: PathBuf,
    /// Made from its content, so a build is never taken for another of the same version.
    name: OnceLock<String>,
}

impl LinuxHelper {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            name: OnceLock::new(),
        }
    }

    /// The command that starts the helper on `machine` to serve, installed there first if it is
    /// not.
    pub fn serve(&self, machine: &dyn LinuxMachine) -> anyhow::Result<Command> {
        let mut command = machine.command(&self.installed(machine)?);
        command.arg("serve");
        Ok(command)
    }

    fn name(&self) -> anyhow::Result<&str> {
        if let Some(name) = self.name.get() {
            return Ok(name);
        }
        let bytes = std::fs::read(&self.file)
            .with_context(|| format!("could not read the helper at {}", self.file.display()))?;
        Ok(self.name.get_or_init(|| installed_name(&bytes)))
    }

    /// The helper on `machine`, installed first if it is not there, as a path from its home.
    fn installed(&self, machine: &dyn LinuxMachine) -> anyhow::Result<String> {
        let name = self.name()?;
        let path = format!("{SERVER_DIR}/{name}");
        if runs(machine, &path)? {
            return Ok(path);
        }
        tracing::info!(machine = machine.name(), name, "installing the helper");
        self.install(machine, name)?;
        // one that cannot run there (another architecture, a home mounted noexec) is not copied
        // again at every start
        anyhow::ensure!(
            runs(machine, &path)?,
            "the helper installed in {} does not run there",
            machine.name()
        );
        Ok(path)
    }

    fn install(&self, machine: &dyn LinuxMachine, name: &str) -> anyhow::Result<()> {
        let unanswered = || format!("{} did not answer", machine.name());
        if let Some(mut copy) = machine.copy(&self.file, SERVER_DIR, name) {
            let copied = process::run(&mut copy, None, MAX_OUTPUT, START_TIMEOUT)
                .with_context(unanswered)?;
            if copied.code == 0 {
                return Ok(());
            }
            tracing::info!(
                stderr = copied.stderr,
                "the helper could not be copied: streaming it"
            );
        }
        let bytes = std::fs::read(&self.file)?;
        let mut stream = machine.command("sh");
        stream.args(["-c", STREAM, "sidekyk-install", SERVER_DIR, name]);
        let streamed = process::run(&mut stream, Some(&bytes), MAX_OUTPUT, START_TIMEOUT)
            .with_context(unanswered)?;
        anyhow::ensure!(
            streamed.code == 0,
            "could not install the helper in {}: {}",
            machine.name(),
            streamed.stderr.trim()
        );
        Ok(())
    }
}

/// Whether the helper at `path` (from the home) runs on `machine`: its name says which build it is.
fn runs(machine: &dyn LinuxMachine, path: &str) -> anyhow::Result<bool> {
    let mut version = machine.command(path);
    version.arg("version");
    let output = process::run(&mut version, None, MAX_OUTPUT, START_TIMEOUT)
        .with_context(|| format!("{} did not answer", machine.name()))?;
    Ok(output.code == 0)
}

/// `sidekyk-agent-<version>-<hash of its content>`.
fn installed_name(helper: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(helper);
    format!("sidekyk-agent-{VERSION}-{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_helper_is_installed_under_a_name_from_its_content() {
        let name = installed_name(b"one build");
        assert!(name.starts_with(&format!("sidekyk-agent-{VERSION}-")));
        assert_eq!(name, installed_name(b"one build"));
        assert_ne!(name, installed_name(b"another build"));
    }
}
