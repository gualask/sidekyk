//! WSL distros: each one's repositories through the helper started there (`linux_helper`,
//! `docs/features/wsl.md`), reached through `wsl.exe` (`wsl_exe`). Windows only: elsewhere
//! `wsl.exe` is not found, and every call fails.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::linux_helper::LinuxHelper;
use super::wsl_exe::{distro_state, installed_distro, plain_windows_path, Distro, DistroState};
use crate::app::machines::{Machine, MachineReader};
use crate::infrastructure::agent::AgentRepositories;
use crate::modules::projects::{same_distro, FoundFolder, Location, ProjectList};
use crate::modules::reader::Repositories;
use crate::shared::error::{user_facing, UserFacingError, UserFacingErrorCode};
use crate::shared::sync::lock;

/// A distro's state read for one card serves the others of that distro shown with it.
const STATE_KEPT: Duration = Duration::from_secs(5);

/// A path of a WSL distro as Windows names it, as the folder dialog gives it:
/// `\\wsl.localhost\<distro>\…`, or `\\wsl$\<distro>\…` on older Windows 10. The distro, and the
/// path in it.
fn wsl_path(path: &Path) -> Option<(String, String)> {
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
    /// How each distro names a folder of Windows (its helper's `wslpath`), by the distro's name in
    /// lower case and the folder: asked once a session, not once per file.
    linux_folders: Mutex<HashMap<(String, PathBuf), String>>,
}

impl WslRepositories {
    /// `helper`: the Linux helper the installer ships, on Windows' side.
    pub fn new(helper: PathBuf) -> Self {
        Self {
            helper: Arc::new(LinuxHelper::new(helper)),
            distros: Mutex::default(),
            hidden: AtomicBool::new(false),
            states: Mutex::default(),
            linux_folders: Mutex::default(),
        }
    }

    /// What reads `distro`'s repositories. Starts nothing until asked something.
    fn of(&self, distro: &str) -> Arc<AgentRepositories> {
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

    /// Whether `distro` can be read without starting it, as the projects' rows are: a helper runs
    /// there, or the distro does. Otherwise `distro_stopped`, or `distro_missing`.
    fn distro_readable_without_starting(&self, distro: &str) -> anyhow::Result<()> {
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

    /// `distro_state`, listed once for the rows of one distro shown together.
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
}

/// `name` in a folder a distro names `linux_folder`.
fn in_linux_folder(linux_folder: &str, name: &str) -> String {
    format!("{}/{name}", linux_folder.trim_end_matches('/'))
}

/// The distro of a WSL folder; `Machines` asks only about the folders this machine holds.
fn distro_of(location: &Location) -> &str {
    match location {
        Location::Wsl { distro, .. } => distro,
        Location::Local { .. } => "",
    }
}

impl Machine for WslRepositories {
    fn holds(&self, location: &Location) -> bool {
        matches!(location, Location::Wsl { .. })
    }

    fn reader(&self, location: &Location) -> Arc<dyn Repositories> {
        self.of(distro_of(location))
    }

    fn readable_without_starting(&self, location: &Location) -> anyhow::Result<()> {
        self.distro_readable_without_starting(distro_of(location))
    }

    /// Each distro asked for so far, reading its own folders.
    fn readers(&self) -> Vec<MachineReader> {
        lock(&self.distros)
            .iter()
            .map(|(distro, repositories)| {
                let distro = distro.clone();
                MachineReader {
                    reader: repositories.clone(),
                    holds: Box::new(move |location| {
                        matches!(location, Location::Wsl { distro: d, .. } if same_distro(d, &distro))
                    }),
                }
            })
            .collect()
    }

    /// A path of a WSL distro as Windows names it (`\\wsl.localhost\<distro>\…`), read in that
    /// distro; the distro as WSL names it: `ubuntu` typed in the dialog is the project of `Ubuntu`.
    fn folder_at(&self, path: &Path) -> Option<anyhow::Result<FoundFolder>> {
        let (distro, path) = wsl_path(path)?;
        Some((|| {
            let distro = installed_distro(&distro)?;
            let found = self.of(&distro).resolve(Path::new(&path))?;
            Ok(FoundFolder {
                name: found.name,
                location: Location::Wsl {
                    distro,
                    root: found.root,
                },
            })
        })())
    }

    /// Asked of the distro's helper, which runs `wslpath` there: no `wsl.exe` while it runs, as
    /// it does once a folder of the distro was read. The folder's name asked once a session
    /// (`linux_folders`), the file's name added to it.
    fn host_path(&self, location: &Location, path: &Path) -> anyhow::Result<String> {
        let distro = distro_of(location);
        let linux_path = |path: &Path| self.of(distro).linux_path(&plain_windows_path(path));
        let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
            return linux_path(path);
        };
        let key = (distro.to_ascii_lowercase(), folder.to_path_buf());
        let known = lock(&self.linux_folders).get(&key).cloned();
        let linux_folder = match known {
            Some(linux_folder) => linux_folder,
            None => {
                let linux_folder = linux_path(folder)?;
                lock(&self.linux_folders).insert(key, linux_folder.clone());
                linux_folder
            }
        };
        Ok(in_linux_folder(&linux_folder, &name.to_string_lossy()))
    }

    /// A path of a distro as Windows names it; never a link resolved, as the distro reads it.
    fn holds_host_path(&self, list: &ProjectList, path: &Path) -> Option<bool> {
        let (distro, path) = wsl_path(path)?;
        Some(list.holds_in_wsl(&distro, &path))
    }

    /// Every distro, and the ones asked for later too; a helper tells a change it saw meanwhile
    /// as a change.
    fn set_visible(&self, visible: bool) -> Option<Location> {
        let distros = lock(&self.distros);
        self.hidden.store(!visible, Ordering::Relaxed);
        for repositories in distros.values() {
            repositories.set_visible(visible);
        }
        None
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
    fn a_file_is_named_in_its_folder_as_the_distro_names_the_folder() {
        assert_eq!(
            in_linux_folder(
                "/mnt/c/Users/me/AppData/notes/shop-3f9a2c/",
                "00112233445566ff.png"
            ),
            "/mnt/c/Users/me/AppData/notes/shop-3f9a2c/00112233445566ff.png"
        );
        assert_eq!(
            in_linux_folder("/mnt/c/notes", "a.png"),
            "/mnt/c/notes/a.png"
        );
    }
}
