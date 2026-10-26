//! The helper end to end: this crate's binary, started as the app starts it, answering what the
//! app reads directly, on a scratch repository with a real git.

use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sidekyk_core::infrastructure::agent::AgentRepositories;
use sidekyk_core::infrastructure::git_cli::LocalRepositoryBackend;
use sidekyk_core::infrastructure::watcher::LocalRepositoryWatcher;
use sidekyk_core::modules::folder::FolderKind;
use sidekyk_core::modules::repositories::{LocalRepositories, Repositories};
use sidekyk_core::modules::repository::{FileContent, FileDiffRequest, RepositoryInfo};
use sidekyk_core::shared::error::{user_facing_code, UserFacingErrorCode};

/// Past the watcher's quiet period (250 ms) and the system's own delay.
const QUIET: Duration = Duration::from_secs(1);
const DEADLINE: Duration = Duration::from_secs(10);

fn agent() -> AgentRepositories {
    AgentRepositories::new(|| Ok(helper()))
}

/// This crate's binary, to serve.
fn helper() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_sidekyk-agent"));
    command.arg("serve");
    command
}

fn local() -> Arc<LocalRepositories> {
    LocalRepositories::new(
        Arc::new(LocalRepositoryBackend::default()),
        Arc::new(LocalRepositoryWatcher::default()),
    )
}

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

fn write(root: &Path, rel: &str, body: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

/// A repository with a commit, then one change of each kind and an ignored folder.
fn scratch_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "user.email", "test@example.com"]);
    git(root, &["config", "user.name", "Test"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    write(root, ".gitignore", "build/\n");
    write(root, "src/cart.ts", "a\nb\nc\n");
    write(root, "README.md", "hello\n\n![logo](docs/logo.png)\n");
    std::fs::create_dir_all(root.join("docs")).unwrap();
    std::fs::write(
        root.join("docs/logo.png"),
        [0x89, b'P', b'N', b'G', 0, 0xFF, b'\n'],
    )
    .unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-q", "-m", "init"]);
    write(root, "src/cart.ts", "a\nB\nc\nd\n");
    write(root, "notes/todo.md", "find me\n");
    write(root, "build/out.o", "");
    dir
}

fn json(value: &impl serde::Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

#[test]
fn version_names_the_binary() {
    let out = Command::new(env!("CARGO_BIN_EXE_sidekyk-agent"))
        .arg("version")
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8(out.stdout).unwrap().trim(),
        env!("CARGO_PKG_VERSION")
    );
}

#[test]
fn the_helper_answers_as_the_app_reads_directly() {
    let dir = scratch_repo();
    let (agent, local) = (agent(), local());
    let info = agent.resolve(&dir.path().join("src")).unwrap();
    assert_eq!(info, local.resolve(dir.path()).unwrap());

    assert_eq!(
        json(&agent.snapshot(&info).unwrap()),
        json(&local.snapshot(&info).unwrap())
    );
    assert_eq!(
        json(&agent.summary(&info).unwrap()),
        json(&local.summary(&info).unwrap())
    );
    assert_eq!(
        json(&agent.changes_ignoring_whitespace(&info).unwrap()),
        json(&local.changes_ignoring_whitespace(&info).unwrap())
    );
    assert_eq!(
        json(&agent.recent_commits(&info).unwrap()),
        json(&local.recent_commits(&info).unwrap())
    );
    assert_eq!(
        json(&agent.commit_activity(&info, 0).unwrap()),
        json(&local.commit_activity(&info, 0).unwrap())
    );
    assert_eq!(
        json(&agent.directory(&info, "").unwrap()),
        json(&local.directory(&info, "").unwrap())
    );
    assert!(matches!(
        agent.file_content(&info, "src/cart.ts").unwrap(),
        FileContent::Text { text, .. } if text == "a\nB\nc\nd\n"
    ));
    let files = agent.search_files(&info, "cart").unwrap();
    assert_eq!(files.files[0].path, "src/cart.ts");
    // a preview, an image's bytes as they are, and its stamp
    assert_eq!(
        json(&agent.markdown_preview(&info, "README.md").unwrap()),
        json(&local.markdown_preview(&info, "README.md").unwrap())
    );
    assert_eq!(
        agent.image(&info, "docs/logo.png").unwrap(),
        [0x89, b'P', b'N', b'G', 0, 0xFF, b'\n']
    );
    assert_eq!(
        agent.file_stamp(&info, "docs/logo.png").unwrap(),
        local.file_stamp(&info, "docs/logo.png").unwrap()
    );
    let not_an_image = agent.image(&info, "src/cart.ts").unwrap_err();
    assert_eq!(
        user_facing_code(&not_an_image),
        Some(UserFacingErrorCode::FileMissing)
    );

    let found = Mutex::new(Vec::new());
    let end = agent
        .search_contents(&info, "find me", &|files| {
            found
                .lock()
                .unwrap()
                .extend(files.into_iter().map(|f| f.path));
        })
        .unwrap();
    assert!(!end.cancelled && !end.more);
    assert_eq!(*found.lock().unwrap(), ["notes/todo.md"]);
}

#[test]
fn a_folder_without_git_is_listed_through_the_helper() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".ignore", "draft.md\n");
    write(dir.path(), "draft.md", "");
    write(dir.path(), "notes/todo.md", "find me\n");
    let agent = agent();
    let info = agent.resolve(dir.path()).unwrap();
    assert_eq!(agent.folder_kind(&info).unwrap(), FolderKind::Plain);
    let root = agent.directory(&info, "").unwrap();
    let names: Vec<&str> = root.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["notes", ".ignore"]);
}

#[test]
fn a_failure_keeps_its_code_through_the_helper() {
    let dir = scratch_repo();
    let agent = agent();
    let info = agent.resolve(dir.path()).unwrap();
    let error = agent.file_content(&info, "build/out.o").unwrap_err();
    assert_eq!(
        user_facing_code(&error),
        Some(UserFacingErrorCode::FileMissing)
    );
    let error = agent.resolve(&dir.path().join("nowhere")).unwrap_err();
    assert_eq!(
        user_facing_code(&error),
        Some(UserFacingErrorCode::RepositoryMissing)
    );
    let moved = RepositoryInfo {
        root: dir.path().join("moved").to_string_lossy().into_owned(),
        name: "moved".into(),
    };
    let error = agent.snapshot(&moved).unwrap_err();
    assert_eq!(
        user_facing_code(&error),
        Some(UserFacingErrorCode::RepositoryMissing)
    );
}

#[test]
fn changes_come_through_the_helper_and_a_missed_one_when_the_window_shows() {
    let dir = scratch_repo();
    let agent = agent();
    let info = agent.resolve(dir.path()).unwrap();
    let root = Path::new(&info.root);
    let (sent, received) = mpsc::channel();
    agent.watch(
        Some(&info),
        Box::new(move |event| {
            let _ = sent.send(event);
        }),
    );
    // events still on their way, such as FSEvents reporting what happened before the watch
    let settle = || {
        let started = Instant::now();
        while received.recv_timeout(QUIET).is_ok() {
            assert!(started.elapsed() < DEADLINE, "the watcher never went quiet");
        }
    };
    settle();

    write(root, "src/cart.ts", "changed\n");
    let event = received.recv_timeout(DEADLINE).unwrap();
    assert_eq!(event.root, info.root);
    settle();

    // the helper is not waited for: told hidden, a change, then shown again
    assert_eq!(agent.set_visible(false), None);
    write(root, "src/cart.ts", "again\n");
    let started = Instant::now();
    let event = loop {
        assert_eq!(agent.set_visible(true), None);
        if let Ok(event) = received.recv_timeout(Duration::from_millis(200)) {
            break event;
        }
        agent.set_visible(false);
        assert!(started.elapsed() < DEADLINE, "the missed change never came");
    };
    assert_eq!(event.root, info.root);
    agent.watch(None, Box::new(|_| {}));
}

#[test]
fn a_helper_that_stops_at_once_is_not_started_at_every_request() {
    let starts = Arc::new(AtomicUsize::new(0));
    let counted = starts.clone();
    // a helper that exits at once, or cannot start where `true` is missing
    let agent = AgentRepositories::new(move || {
        counted.fetch_add(1, Ordering::Relaxed);
        Ok(Command::new("true"))
    });
    assert!(agent.resolve(Path::new(".")).is_err());
    let error = agent.resolve(Path::new(".")).unwrap_err();
    assert_eq!(starts.load(Ordering::Relaxed), 1, "{error:#}");
    assert_eq!(
        user_facing_code(&error),
        Some(UserFacingErrorCode::HelperFailed)
    );
}

/// A client of this crate's binary closing it when idle for `after`, and how many it started.
fn counting(after: Duration) -> (AgentRepositories, Arc<AtomicUsize>) {
    let starts = Arc::new(AtomicUsize::new(0));
    let counted = starts.clone();
    let agent = AgentRepositories::closing_after(after, move || {
        counted.fetch_add(1, Ordering::Relaxed);
        Ok(helper())
    });
    (agent, starts)
}

#[test]
fn watching_nothing_starts_no_helper() {
    let (agent, starts) = counting(Duration::from_secs(60));
    agent.watch(None, Box::new(|_| {}));
    agent.set_visible(false);
    agent.retain(&[]);
    assert_eq!(starts.load(Ordering::Relaxed), 0);
}

#[test]
fn an_idle_helper_is_closed_unless_it_watches() {
    const IDLE: Duration = Duration::from_millis(300);
    let dir = scratch_repo();
    let (agent, starts) = counting(IDLE);
    let info = agent.resolve(dir.path()).unwrap();
    std::thread::sleep(IDLE * 3);
    agent.summary(&info).unwrap();
    assert_eq!(
        starts.load(Ordering::Relaxed),
        2,
        "closed once idle, started again"
    );

    agent.watch(Some(&info), Box::new(|_| {}));
    std::thread::sleep(IDLE * 3);
    agent.summary(&info).unwrap();
    assert_eq!(starts.load(Ordering::Relaxed), 2, "kept while it watches");

    agent.watch(None, Box::new(|_| {}));
    std::thread::sleep(IDLE * 3);
    agent.summary(&info).unwrap();
    assert_eq!(
        starts.load(Ordering::Relaxed),
        3,
        "closed once it watches nothing"
    );
}

/// The median of `runs` calls to `work`, after one warm-up call.
fn median(runs: usize, mut work: impl FnMut()) -> Duration {
    work();
    let mut times: Vec<Duration> = (0..runs)
        .map(|_| {
            let started = Instant::now();
            work();
            started.elapsed()
        })
        .collect();
    times.sort();
    times[runs / 2]
}

/// What reading through the helper costs over reading directly, on a real repository:
/// `SIDEKYK_BENCH_REPO=/path/to/repo cargo test --release -p sidekyk-agent agent_timings -- --ignored --nocapture`
#[test]
#[ignore = "benchmark, needs SIDEKYK_BENCH_REPO"]
fn agent_timings() {
    let repo = std::env::var("SIDEKYK_BENCH_REPO").expect("SIDEKYK_BENCH_REPO is set");
    let (agent, local) = (agent(), local());
    let info = local.resolve(Path::new(&repo)).unwrap();
    let snapshot = local.snapshot(&info).unwrap();
    let largest = snapshot
        .files
        .iter()
        .filter(|f| !f.binary)
        .max_by_key(|f| f.additions.unwrap_or(0) + f.deletions.unwrap_or(0))
        .map(|f| FileDiffRequest {
            path: f.path.clone(),
            orig_path: f.orig_path.clone(),
            area: f.area,
            whole_file: false,
        });
    println!("{}: {} changed files", info.root, snapshot.files.len());
    let both: [(&str, &dyn Repositories); 2] = [("direct", &*local), ("helper", &agent)];
    for (name, repositories) in both {
        let snapshot = median(10, || {
            repositories.snapshot(&info).unwrap();
        });
        let directory = median(50, || {
            repositories.directory(&info, "").unwrap();
        });
        let files = median(20, || {
            repositories.search_files(&info, "srcmod");
        });
        let diff = largest.as_ref().map_or_else(
            || "none".to_string(),
            |request| {
                let bytes = repositories.file_diff(&info, request).unwrap().text.len();
                let time = median(20, || {
                    repositories.file_diff(&info, request).unwrap();
                });
                format!("{time:?} ({bytes} bytes)")
            },
        );
        println!(
            "{name}: snapshot {snapshot:?}, root folder {directory:?}, palette files {files:?}, \
             largest diff {diff}"
        );
    }
}
