//! `wsl.exe`: the distros installed and which ones run, and a program run in one (`Distro`, the
//! `LinuxMachine` the helper is installed and started through). Windows only: elsewhere
//! `wsl.exe` is not found, and every call fails.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::Context;

use super::linux_helper::LinuxMachine;
use crate::infrastructure::hide_console;
use crate::infrastructure::process;
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Listing the distros starts none.
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_OUTPUT: usize = 64 * 1024;

/// Copies the helper from Windows' side through `/mnt`, under a temporary name first, so a copy
/// cut short is never taken for the helper. `$1` the folder, `$2` the helper's name, `$3` its
/// Windows path. A distro that does not mount Windows' drives gets it through stdin.
const COPY: &str = r#"set -e; mkdir -p "$1"; tmp="$1/.$2.$$"; cp "$(wslpath -u "$3")" "$tmp"; chmod 755 "$tmp"; mv -f "$tmp" "$1/$2""#;

/// Whether a distro runs, as far as `wsl.exe` tells.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DistroState {
    Running,
    Stopped,
    /// Not installed, or no longer.
    Missing,
}

/// A distro's state, from the names `wsl.exe` lists: never its columns, which a Windows in
/// another language words otherwise. Starts no distro. A listing that fails is an error, never
/// `Missing`: that one offers to remove the project.
pub(super) fn distro_state(distro: &str) -> anyhow::Result<DistroState> {
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
pub(super) fn installed_distro(distro: &str) -> anyhow::Result<String> {
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
pub(super) struct Distro(pub(super) String);

impl LinuxMachine for Distro {
    fn name(&self) -> &str {
        &self.0
    }

    /// `wsl.exe` running `program` in the distro, from its user's home: `env` finds a path
    /// relative to the home.
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
pub(super) fn plain_windows_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
