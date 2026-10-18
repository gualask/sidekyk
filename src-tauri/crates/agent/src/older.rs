//! The helpers the app installed before this one, in the same distro.

use std::path::Path;

use sidekyk_core::infrastructure::wsl::SERVER_DIR;

/// Run by the helper as it starts: in the folder the app installs it in, every other helper (an
/// older build) and any copy left halfway goes. Elsewhere, such as beside a dev build, nothing.
pub(crate) fn remove_other_helpers(this: &Path) -> std::io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
