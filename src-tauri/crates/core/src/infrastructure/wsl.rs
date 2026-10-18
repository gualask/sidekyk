//! WSL distros, through `wsl.exe`: which ones run, and each one's repositories through the helper
//! started there (`linux_helper`, `docs/plans/remote-projects.md`). Windows only: elsewhere
//! `wsl.exe` is not found, and every call fails.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Context;

use super::agent::AgentRepositories;
use super::hide_console;
use super::linux_helper::{LinuxHelper, LinuxMachine};
use super::process;
use crate::modules::repositories::Repositories;
use crate::shared::error::{user_facing, UserFacingError, UserFacingErrorCode};
use crate::shared::sync::lock;

/// Listing the distros starts none.
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
/// A distro's state read for one card serves the others of that distro shown with it.
const STATE_KEPT: Duration = Duration::from_secs(5);
const MAX_OUTPUT: usize = 64 * 1024;

/// Copies the helper from Windows' side through `/mnt`, under a temporary name first, so a copy
/// cut short is never taken for the helper. `$1` the folder, `$2` the helper's name, `$3` its
/// Windows path. A distro that does not mount Windows' drives gets it through stdin.
const COPY: &str = r#"set -e; mkdir -p "$1"; tmp="$1/.$2.$$"; cp "$(wslpath -u "$3")" "$tmp"; chmod 755 "$tmp"; mv -f "$tmp" "$1/$2""#;

/// A path of a WSL distro as Windows names it, as the folder dialog gives it:
/// `\\wsl.localhost\<distro>\…`, or `\\wsl$\<distro>\…` on older Windows 10. The distro, and the
/// path in it.
pub fn wsl_path(path: &Path) -> Option<(String, String)> {
    let path = path.to_str()?;
    let rest = path
        .strip_prefix(r"\\?\UNC\")
        .or_else(|| path.strip_prefix(r"\\"))
        .or_else(|| path.strip_prefix("//"))?;
    let mut parts = rest.split(['\\', '/']).filter(|part| !part.is_empty());
    let host = parts.next()?;
    if !host.eq_ignore_ascii_case("wsl.localhost") && !host.eq_ignore_ascii_case("wsl$") {
        return None;
    }
    let distro = parts.next()?.to_string();
    let path = format!("/{}", parts.collect::<Vec<_>>().join("/"));
    Some((distro, path))
}

/// Whether a distro runs, as far as `wsl.exe` tells.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DistroState {
    Running,
    Stopped,
    /// Not installed, or no longer.
    Missing,
}

/// A distro's state, from the names `wsl.exe` lists: never its columns, which a Windows in
/// another language words otherwise. Starts no distro. A listing that fails is an error, never
/// `Missing`: that one offers to remove the project.
fn distro_state(distro: &str) -> anyhow::Result<DistroState> {
    let named = |names: Vec<String>| names.iter().any(|n| n.eq_ignore_ascii_case(distro));
    // none running makes `wsl.exe` fail too: not running, then
    if named(distros(&["--list", "--running", "--quiet"]).unwrap_or_default()) {
        return Ok(DistroState::Running);
    }
    if named(distros(&["--list", "--quiet"])?) {
        return Ok(DistroState::Stopped);
    }
    Ok(DistroState::Missing)
}

/// The name a distro is installed under, from one written in any case (a path typed by hand):
/// one distro is one helper and one project. `distro_missing` when none has it.
pub fn installed_distro(distro: &str) -> anyhow::Result<String> {
    distros(&["--list", "--quiet"])?
        .into_iter()
        .find(|name| name.eq_ignore_ascii_case(distro))
        .ok_or_else(|| user_facing(UserFacingErrorCode::DistroMissing))
}

/// The distros `wsl.exe` lists; it fails when there are none, as when it cannot answer.
fn distros(args: &[&str]) -> anyhow::Result<Vec<String>> {
    let mut command = Command::new("wsl.exe");
    command
        .args(args)
        // UTF-16 otherwise; a `wsl.exe` older than the variable still writes UTF-16
        .env("WSL_UTF8", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = process::run(&mut command, None, MAX_OUTPUT, LIST_TIMEOUT)
        .context("could not list the WSL distros")?;
    anyhow::ensure!(
        output.code == 0,
        "wsl.exe {} failed: {}",
        args.join(" "),
        output.stderr.trim()
    );
    Ok(listed(&output.stdout))
}

/// The names `wsl.exe --list --quiet` writes, one per line, in UTF-8 or UTF-16LE.
fn listed(output: &[u8]) -> Vec<String> {
    let text = if output.contains(&0) {
        let units: Vec<u16> = output
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(output).into_owned()
    };
    text.lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'))
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect()
}

/// A WSL distro, by its name.
struct Distro(String);

impl LinuxMachine for Distro {
    fn name(&self) -> &str {
        &self.0
    }

    /// `wsl.exe` running `program` in the distro, from its user's home: `env` finds a path
    /// relative to the home, as Zed starts its server.
    fn command(&self, program: &str) -> Command {
        let mut command = Command::new("wsl.exe");
        command
            .args([
                "--distribution",
                &self.0,
                "--cd",
                "~",
                "--exec",
                "env",
                program,
            ])
            // `wsl.exe`'s own messages (a distro unknown) in UTF-8, not UTF-16
            .env("WSL_UTF8", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        command
    }

    fn copy(&self, file: &Path, folder: &str, name: &str) -> Option<Command> {
        let mut copy = self.command("sh");
        let windows_path = plain_windows_path(file);
        copy.args(["-c", COPY, "sidekyk-install", folder, name, &windows_path]);
        Some(copy)
    }
}

/// A Windows path as `wslpath` reads it: without the `\\?\` prefix Windows' own APIs give, which
/// it does not know.
fn plain_windows_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
}

/// A helper that could not be checked or installed in `distro`: `distro_missing` when the distro
/// is gone for sure, else the failure as it is.
fn missing_or(distro: &str, error: anyhow::Error) -> anyhow::Error {
    match distro_state(distro) {
        Ok(DistroState::Missing) => {
            error.context(UserFacingError::new(UserFacingErrorCode::DistroMissing))
        }
        _ => error,
    }
}

/// The repositories of WSL distros: one helper per distro, started on first need there.
pub struct WslRepositories {
    helper: Arc<LinuxHelper>,
    /// By the distro's name in lower case: WSL's names ignore case.
    distros: Mutex<HashMap<String, Arc<AgentRepositories>>>,
    /// The window is hidden: a distro asked for meanwhile is told, as the others were.
    hidden: AtomicBool,
    /// Each distro's state as last listed, by its name in lower case, for `STATE_KEPT`.
    states: Mutex<HashMap<String, (Instant, DistroState)>>,
}

impl WslRepositories {
    /// `helper`: the Linux helper the installer ships, on Windows' side.
    pub fn new(helper: PathBuf) -> Self {
        Self {
            helper: Arc::new(LinuxHelper::new(helper)),
            distros: Mutex::default(),
            hidden: AtomicBool::new(false),
            states: Mutex::default(),
        }
    }

    /// What reads `distro`'s repositories. Starts nothing until asked something.
    pub fn of(&self, distro: &str) -> Arc<AgentRepositories> {
        let key = distro.to_ascii_lowercase();
        let mut distros = lock(&self.distros);
        if let Some(repositories) = distros.get(&key) {
            return repositories.clone();
        }
        let (helper, name) = (self.helper.clone(), distro.to_string());
        let repositories = Arc::new(AgentRepositories::new(move || {
            helper
                .serve(&Distro(name.clone()))
                .map_err(|error| missing_or(&name, error))
        }));
        if self.hidden.load(Ordering::Relaxed) {
            repositories.set_visible(false);
        }
        distros.insert(key, repositories.clone());
        repositories
    }

    /// Tells every distro whether the window shows, and the ones asked for later too.
    pub fn set_visible(&self, visible: bool) {
        let distros = lock(&self.distros);
        self.hidden.store(!visible, Ordering::Relaxed);
        for repositories in distros.values() {
            repositories.set_visible(visible);
        }
    }

    /// Whether `distro` can be read without starting it, as the projects' cards are: a helper runs
    /// there, or the distro does. Otherwise `distro_stopped`, or `distro_missing`.
    pub fn readable_without_starting(&self, distro: &str) -> anyhow::Result<()> {
        if self.of(distro).is_running() {
            return Ok(());
        }
        match self.state(distro) {
            Ok(DistroState::Running) => Ok(()),
            Ok(DistroState::Stopped) => Err(user_facing(UserFacingErrorCode::DistroStopped)),
            Ok(DistroState::Missing) => Err(user_facing(UserFacingErrorCode::DistroMissing)),
            // `wsl.exe` did not answer: a passing failure, never a distro to remove
            Err(error) => {
                Err(error.context(UserFacingError::new(UserFacingErrorCode::HelperFailed)))
            }
        }
    }

    /// `distro_state`, listed once for the cards of one distro shown together.
    fn state(&self, distro: &str) -> anyhow::Result<DistroState> {
        let key = distro.to_ascii_lowercase();
        if let Some((at, state)) = lock(&self.states).get(&key) {
            if at.elapsed() < STATE_KEPT {
                return Ok(*state);
            }
        }
        let state = distro_state(distro)?;
        lock(&self.states).insert(key, (Instant::now(), state));
        Ok(state)
    }

    /// Every distro asked for so far, with what reads its repositories.
    pub fn each(&self) -> Vec<(String, Arc<AgentRepositories>)> {
        lock(&self.distros)
            .iter()
            .map(|(distro, repositories)| (distro.clone(), repositories.clone()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wsl_path_names_its_distro_and_the_path_in_it() {
        let found = |path: &str| wsl_path(Path::new(path));
        let shop = Some(("Ubuntu".to_string(), "/home/ale/shop".to_string()));
        assert_eq!(found(r"\\wsl.localhost\Ubuntu\home\ale\shop"), shop);
        assert_eq!(found(r"\\wsl$\Ubuntu\home\ale\shop\"), shop);
        assert_eq!(found(r"\\WSL.LOCALHOST\Ubuntu\home\ale\shop"), shop);
        assert_eq!(found(r"\\?\UNC\wsl.localhost\Ubuntu\home\ale\shop"), shop);
        assert_eq!(found("//wsl.localhost/Ubuntu/home/ale/shop"), shop);
        assert_eq!(
            found(r"\\wsl.localhost\Ubuntu"),
            Some(("Ubuntu".to_string(), "/".to_string()))
        );
        assert_eq!(found(r"\\server\share\shop"), None);
        assert_eq!(found(r"C:\Users\ale\shop"), None);
        assert_eq!(found(r"\\wsl.localhost"), None);
    }

    #[test]
    fn a_windows_path_loses_the_prefix_wslpath_does_not_know() {
        let plain = |path: &str| plain_windows_path(Path::new(path));
        assert_eq!(
            plain(r"\\?\C:\Program Files\Sidekyk\linux\sidekyk-agent"),
            r"C:\Program Files\Sidekyk\linux\sidekyk-agent"
        );
        assert_eq!(
            plain(r"\\?\UNC\server\share\sidekyk-agent"),
            r"\\server\share\sidekyk-agent"
        );
        assert_eq!(
            plain(r"C:\Sidekyk\sidekyk-agent"),
            r"C:\Sidekyk\sidekyk-agent"
        );
    }

    #[test]
    fn distros_are_read_in_utf8_or_utf16() {
        assert_eq!(listed(b"Ubuntu\r\nDebian\r\n\r\n"), ["Ubuntu", "Debian"]);
        let utf16: Vec<u8> = "\u{feff}Ubuntu\r\nDebian\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(listed(&utf16), ["Ubuntu", "Debian"]);
        assert!(listed(b"").is_empty());
    }
}
