//! WSL distros, through `wsl.exe`: which ones run, and the helper installed and started in one
//! (`docs/plans/remote-projects.md`). Windows only: elsewhere `wsl.exe` is not found, and every
//! call fails.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use anyhow::Context;

use super::agent::AgentRepositories;
use super::hide_console;
use super::process;
use crate::modules::repositories::Repositories;
use crate::shared::error::{user_facing, UserFacingError, UserFacingErrorCode};
use crate::shared::sync::lock;

/// Where the helper is installed in a distro, under its user's home.
const SERVER_DIR: &str = ".sidekyk-server";
/// `wsl.exe` starts a stopped distro before it runs anything there.
const START_TIMEOUT: Duration = Duration::from_secs(60);
/// Listing the distros starts none.
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_OUTPUT: usize = 64 * 1024;

/// Copies the helper from Windows' side through `/mnt`, under a temporary name first, so a copy
/// cut short is never taken for the helper. `$1` the folder, `$2` the helper's name, `$3` its
/// Windows path.
const COPY: &str = r#"set -e; mkdir -p "$1"; tmp="$1/.$2.$$"; cp "$(wslpath -u "$3")" "$tmp"; chmod 755 "$tmp"; mv -f "$tmp" "$1/$2""#;
/// As `COPY`, the helper read from stdin: for a distro that does not mount Windows' drives.
const STREAM: &str = r#"set -e; mkdir -p "$1"; tmp="$1/.$2.$$"; cat > "$tmp"; chmod 755 "$tmp"; mv -f "$tmp" "$1/$2""#;

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
pub enum DistroState {
    Running,
    Stopped,
    /// Not installed, or no longer.
    Missing,
}

/// A distro's state, from the names `wsl.exe` lists: never its columns, which a Windows in
/// another language words otherwise. Starts no distro.
pub fn distro_state(distro: &str) -> anyhow::Result<DistroState> {
    let named = |names: Vec<String>| names.iter().any(|n| n.eq_ignore_ascii_case(distro));
    if named(distros(&["--list", "--running", "--quiet"])?) {
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
    distros(&["--list", "--quiet"])
        .context(UserFacingError::new(UserFacingErrorCode::DistroMissing))?
        .into_iter()
        .find(|name| name.eq_ignore_ascii_case(distro))
        .ok_or_else(|| user_facing(UserFacingErrorCode::DistroMissing))
}

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
    // none installed, or none running: an error message, not names
    if output.code != 0 {
        return Ok(Vec::new());
    }
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

/// `wsl.exe` running `program` in `distro`, from its user's home, without a shell: `env` finds a
/// path relative to the home, as Zed starts its server.
fn wsl(distro: &str, program: &str) -> Command {
    let mut command = Command::new("wsl.exe");
    command
        .args([
            "--distribution",
            distro,
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

/// A Windows path as `wslpath` reads it: without the `\\?\` prefix Windows' own APIs give, which
/// it does not know.
fn plain_windows_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
}

/// The helper the installer ships, installed in a distro on its first use there.
struct Helper {
    /// On Windows' side, in the app's resources.
    file: PathBuf,
    /// Made from its content, so a build is never taken for another of the same version.
    name: OnceLock<String>,
}

impl Helper {
    fn name(&self) -> anyhow::Result<&str> {
        if let Some(name) = self.name.get() {
            return Ok(name);
        }
        let bytes = std::fs::read(&self.file)
            .with_context(|| format!("could not read the helper at {}", self.file.display()))?;
        Ok(self.name.get_or_init(|| installed_name(&bytes)))
    }

    /// The helper in `distro`, installed first if it is not there, as a path from its home.
    fn installed(&self, distro: &str) -> anyhow::Result<String> {
        let name = self.name()?;
        let path = format!("{SERVER_DIR}/{name}");
        if runs(distro, &path)? {
            return Ok(path);
        }
        tracing::info!(distro, name, "installing the helper");
        self.install(distro, name)?;
        // one that cannot run there (another architecture, a home mounted noexec) is not copied
        // again at every start
        anyhow::ensure!(
            runs(distro, &path)?,
            "the helper installed in {distro} does not run there"
        );
        Ok(path)
    }

    fn install(&self, distro: &str, name: &str) -> anyhow::Result<()> {
        let windows_path = plain_windows_path(&self.file);
        let mut copy = wsl(distro, "sh");
        copy.args([
            "-c",
            COPY,
            "sidekyk-install",
            SERVER_DIR,
            name,
            &windows_path,
        ]);
        let copied = process::run(&mut copy, None, MAX_OUTPUT, START_TIMEOUT)
            .with_context(|| format!("WSL {distro} did not answer"))?;
        if copied.code != 0 {
            tracing::info!(
                stderr = copied.stderr,
                "the helper could not be copied: streaming it"
            );
            let bytes = std::fs::read(&self.file)?;
            let mut stream = wsl(distro, "sh");
            stream.args(["-c", STREAM, "sidekyk-install", SERVER_DIR, name]);
            let streamed = process::run(&mut stream, Some(&bytes), MAX_OUTPUT, START_TIMEOUT)
                .with_context(|| format!("WSL {distro} did not answer"))?;
            anyhow::ensure!(
                streamed.code == 0,
                "could not install the helper in {distro}: {}",
                streamed.stderr.trim()
            );
        }
        Ok(())
    }
}

/// Whether the helper at `path` (from the home) runs in `distro`: its name says which build it is.
fn runs(distro: &str, path: &str) -> anyhow::Result<bool> {
    let mut version = wsl(distro, path);
    version.arg("version");
    let output = process::run(&mut version, None, MAX_OUTPUT, START_TIMEOUT)
        .with_context(|| format!("WSL {distro} did not answer"))?;
    Ok(output.code == 0)
}

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A helper that could not be checked or installed in `distro`: `distro_missing` when the distro,
/// or WSL, is gone, else the failure as it is.
fn missing_or(distro: &str, error: anyhow::Error) -> anyhow::Error {
    match distro_state(distro) {
        Ok(DistroState::Missing) | Err(_) => {
            error.context(UserFacingError::new(UserFacingErrorCode::DistroMissing))
        }
        Ok(_) => error,
    }
}

/// `sidekyk-agent-<version>-<hash of its content>`.
fn installed_name(helper: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(helper);
    format!("sidekyk-agent-{VERSION}-{:016x}", hasher.finish())
}

/// Run by the helper as it starts: in the folder the app installs it in, every other helper (an
/// older build) and any copy left halfway goes. Elsewhere, such as beside a dev build, nothing.
pub fn remove_other_helpers(this: &Path) -> std::io::Result<()> {
    let Some(folder) = this
        .parent()
        .filter(|f| f.file_name() == Some(SERVER_DIR.as_ref()))
    else {
        return Ok(());
    };
    for entry in std::fs::read_dir(folder)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let helper = name.trim_start_matches('.').starts_with("sidekyk-agent-");
        if helper && path != this {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// The repositories of WSL distros: one helper per distro, started on first need there.
pub struct WslRepositories {
    helper: Arc<Helper>,
    /// By the distro's name in lower case: WSL's names ignore case.
    distros: Mutex<HashMap<String, Arc<AgentRepositories>>>,
    /// The window is hidden: a distro asked for meanwhile is told, as the others were.
    hidden: AtomicBool,
}

impl WslRepositories {
    /// `helper`: the Linux helper the installer ships, on Windows' side.
    pub fn new(helper: PathBuf) -> Self {
        Self {
            helper: Arc::new(Helper {
                file: helper,
                name: OnceLock::new(),
            }),
            distros: Mutex::default(),
            hidden: AtomicBool::new(false),
        }
    }

    /// What reads `distro`'s repositories. Starts nothing until asked something.
    pub fn of(&self, distro: &str) -> Arc<AgentRepositories> {
        let key = distro.to_lowercase();
        let mut distros = lock(&self.distros);
        if let Some(repositories) = distros.get(&key) {
            return repositories.clone();
        }
        let (helper, name) = (self.helper.clone(), distro.to_string());
        let repositories = Arc::new(AgentRepositories::new(move || {
            let path = helper
                .installed(&name)
                .map_err(|error| missing_or(&name, error))?;
            let mut command = wsl(&name, &path);
            command.arg("serve");
            Ok(command)
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
        match distro_state(distro) {
            Ok(DistroState::Running) => Ok(()),
            Ok(DistroState::Stopped) => Err(user_facing(UserFacingErrorCode::DistroStopped)),
            Ok(DistroState::Missing) => Err(user_facing(UserFacingErrorCode::DistroMissing)),
            Err(error) => {
                Err(error.context(UserFacingError::new(UserFacingErrorCode::DistroMissing)))
            }
        }
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

    #[test]
    fn a_helper_starting_removes_the_others_only_where_the_app_installs_it() {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join(SERVER_DIR);
        std::fs::create_dir(&folder).unwrap();
        for name in [
            "sidekyk-agent-0.1.0-a",
            "sidekyk-agent-0.1.0-b",
            ".sidekyk-agent-0.1.0-b.42",
            "notes",
        ] {
            std::fs::write(folder.join(name), "").unwrap();
        }
        remove_other_helpers(&folder.join("sidekyk-agent-0.1.0-b")).unwrap();
        let mut left: Vec<_> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, ["notes", "sidekyk-agent-0.1.0-b"]);

        let beside = home.path().join("sidekyk-agent-0.1.0-c");
        std::fs::write(home.path().join("sidekyk-agent-old"), "").unwrap();
        remove_other_helpers(&beside).unwrap();
        assert!(home.path().join("sidekyk-agent-old").exists());
    }

    #[test]
    fn a_helper_is_installed_under_a_name_from_its_content() {
        let name = installed_name(b"one build");
        assert!(name.starts_with(&format!("sidekyk-agent-{VERSION}-")));
        assert_eq!(name, installed_name(b"one build"));
        assert_ne!(name, installed_name(b"another build"));
    }
}
