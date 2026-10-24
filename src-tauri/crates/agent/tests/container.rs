//! The Linux helper end to end in the container fixture (`docs/testing.md`, Container fixture), a
//! stand-in for a WSL distro reached with `docker exec` instead of `wsl.exe`: installed as in a
//! distro, then reading, watching with inotify, and closing once idle. Run by
//! `scripts/container-fixture.sh helper <sidekyk-agent>`, a Linux build for the fixture's arch.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use sidekyk_core::infrastructure::agent::AgentRepositories;
use sidekyk_core::infrastructure::linux_helper::{LinuxHelper, LinuxMachine, SERVER_DIR};
use sidekyk_core::modules::folder::FolderKind;
use sidekyk_core::modules::repositories::Repositories;
use sidekyk_core::modules::repository::{RepositoryChange, RepositoryInfo};

const PROJECT: &str = "/home/ubuntu/project";
/// A folder without git, made by the test and removed after.
const VAULT: &str = "/home/ubuntu/vault";
const HOME: &str = "/home/ubuntu";
/// Past the watcher's quiet period (250 ms) and the trip out of the container.
const QUIET: Duration = Duration::from_secs(1);
const DEADLINE: Duration = Duration::from_secs(10);
const IDLE: Duration = Duration::from_secs(2);

/// The fixture's container, by its id: commands run as its `ubuntu` account, from its home.
struct Container(String);

impl LinuxMachine for Container {
    fn name(&self) -> &str {
        "the container fixture"
    }

    fn command(&self, program: &str) -> Command {
        let mut command = Command::new("docker");
        command
            .args([
                "exec", "-i", "-u", "ubuntu", "-w", HOME, &self.0, "env", program,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }
}

impl Container {
    /// What `script` printed, run by `sh` in the container; it must succeed.
    fn run(&self, script: &str) -> String {
        let output = self.command("sh").args(["-c", script]).output().unwrap();
        assert!(
            output.status.success(),
            "{script}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
}

/// Watches `info` through the helper: what it tells comes out of the receiver.
fn watched(agent: &AgentRepositories, info: &RepositoryInfo) -> mpsc::Receiver<RepositoryChange> {
    let (sent, received) = mpsc::channel();
    agent.watch(
        Some(info),
        Box::new(move |change| {
            let _ = sent.send(change);
        }),
    );
    received
}

/// Waits for the watcher to go quiet: events still on their way are dropped.
fn settle(received: &mpsc::Receiver<RepositoryChange>) {
    let started = Instant::now();
    while received.recv_timeout(QUIET).is_ok() {
        assert!(started.elapsed() < DEADLINE, "the watcher never went quiet");
    }
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is set by scripts/container-fixture.sh"))
}

#[test]
#[ignore = "needs the container fixture: scripts/container-fixture.sh helper <sidekyk-agent>"]
fn the_linux_helper_installs_reads_watches_and_closes_in_the_fixture() {
    let container = Arc::new(Container(env("SIDEKYK_CONTAINER")));
    let helper = Arc::new(LinuxHelper::new(PathBuf::from(env("SIDEKYK_LINUX_HELPER"))));
    // a fresh home, with an older build the new one removes when it starts; the seed's file this
    // test edits, kept for the end
    container.run(&format!(
        "rm -rf {SERVER_DIR} && mkdir {SERVER_DIR} && touch {SERVER_DIR}/sidekyk-agent-0.0.0-old \
         && cp {PROJECT}/src/cart.ts /tmp/cart.ts.seed"
    ));

    let starts = Arc::new(AtomicUsize::new(0));
    let agent = {
        let (container, helper, starts) = (container.clone(), helper.clone(), starts.clone());
        AgentRepositories::closing_after(IDLE, move || {
            starts.fetch_add(1, Ordering::Relaxed);
            helper.serve(&*container)
        })
    };

    let started = Instant::now();
    let info = agent.resolve(&Path::new(PROJECT).join("src")).unwrap();
    println!("installed and answered in {:?}", started.elapsed());
    assert_eq!(info.root, PROJECT);
    let started = Instant::now();
    let snapshot = agent.snapshot(&info).unwrap();
    println!(
        "snapshot of {} files in {:?}",
        snapshot.files.len(),
        started.elapsed()
    );
    assert!(
        snapshot.files.len() >= 4,
        "the seed's changes: {snapshot:?}"
    );

    let installed = container.run(&format!("ls -A {SERVER_DIR}"));
    let installed: Vec<&str> = installed.lines().collect();
    assert_eq!(installed.len(), 1, "the older build removed: {installed:?}");
    assert!(
        installed[0].starts_with("sidekyk-agent-") && installed[0] != "sidekyk-agent-0.0.0-old"
    );

    // changes from inside, as an agent's
    let received = watched(&agent, &info);
    settle(&received);
    container.run(&format!("echo '// edited' >> {PROJECT}/src/cart.ts"));
    let change = received.recv_timeout(DEADLINE).unwrap();
    assert_eq!(change.root, PROJECT);
    settle(&received);
    container.run(&format!("echo rebuilt > {PROJECT}/build/out.js"));
    if let Ok(change) = received.recv_timeout(QUIET) {
        panic!("a path git ignores shows nothing: {change:?}");
    }

    // a change while hidden comes when the window shows again
    agent.set_visible(false);
    container.run(&format!("echo '// hidden' >> {PROJECT}/src/cart.ts"));
    let started = Instant::now();
    let missed = loop {
        agent.set_visible(true);
        if let Ok(change) = received.recv_timeout(Duration::from_millis(300)) {
            break change;
        }
        agent.set_visible(false);
        assert!(started.elapsed() < DEADLINE, "the missed change never came");
    };
    assert_eq!(missed.root, PROJECT);

    // a folder without git: listed by its rules, watched with inotify, a repository once `git init`
    container.run(&format!(
        "rm -rf {VAULT} && mkdir -p {VAULT}/notes {VAULT}/drafts && cd {VAULT} \
         && printf 'drafts/\\n' > .ignore && echo a > notes/a.md && echo d > drafts/d.md"
    ));
    let vault = agent.resolve(Path::new(VAULT)).unwrap();
    assert_eq!(vault.root, VAULT);
    assert_eq!(agent.folder_kind(&vault).unwrap(), FolderKind::Plain);
    let names: Vec<String> = agent
        .directory(&vault, "")
        .unwrap()
        .entries
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    assert_eq!(names, ["notes", ".ignore"]);
    let vault_received = watched(&agent, &vault);
    settle(&vault_received);
    container.run(&format!("echo again > {VAULT}/drafts/d.md"));
    if let Ok(change) = vault_received.recv_timeout(QUIET) {
        panic!("a path the rules hide shows nothing: {change:?}");
    }
    container.run(&format!("echo b > {VAULT}/notes/b.md"));
    let change = vault_received.recv_timeout(DEADLINE).unwrap();
    assert_eq!(change.root, VAULT);
    assert!(!change.kind_changed);
    settle(&vault_received);
    container.run(&format!("cd {VAULT} && git init -q"));
    let started = Instant::now();
    while !vault_received
        .recv_timeout(DEADLINE)
        .is_ok_and(|change| change.kind_changed)
    {
        assert!(started.elapsed() < DEADLINE, "git init was never told");
    }
    assert_eq!(agent.folder_kind(&vault).unwrap(), FolderKind::Repository);
    container.run(&format!("rm -rf {VAULT}"));

    // watching nothing, it closes once idle; the next read starts it again, installed already
    agent.watch(None, Box::new(|_| {}));
    std::thread::sleep(IDLE * 3);
    let started = Instant::now();
    agent.summary(&info).unwrap();
    println!("started again in {:?}", started.elapsed());
    assert_eq!(starts.load(Ordering::Relaxed), 2);

    container.run(&format!("cp /tmp/cart.ts.seed {PROJECT}/src/cart.ts"));
}
