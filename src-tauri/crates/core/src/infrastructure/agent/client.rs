//! The app's side: `Repositories` through a helper, a child process talking over its stdin and
//! stdout (`protocol`). A helper that stops is started again on the next request that waits for a
//! reply, told first the repository watched and whether the window shows, as they are then.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Context;
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;

use super::protocol::{read_frame, write_frame, Message, Request, RequestFrame, WireError};
use crate::infrastructure::hide_console;
use crate::modules::repositories::Repositories;
use crate::modules::repository::{
    CommitFileDiffRequest, CommitFiles, CommitRequest, Directory, FileContent, FileDiffRequest,
    RecentCommits, RepositoryChange, RepositoryInfo, RepositorySnapshot, RepositorySummary,
    UnifiedDiff,
};
use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
use crate::modules::syntax::{SyntaxColors, SyntaxRequest};
use crate::shared::sync::lock;

/// A helper that stops, or cannot start, sooner than this is not started again before this long:
/// one failing at once would otherwise be started at every request. One that ran longer makes
/// the app read the repository on screen again, which starts the next.
const STABLE_RUN: Duration = Duration::from_secs(10);

type OnChange = Arc<dyn Fn(RepositoryChange) + Send + Sync>;

pub struct AgentRepositories {
    /// How the helper starts: the local binary, or `wsl.exe` running it in a distro.
    start: Box<dyn Fn() -> Command + Send + Sync>,
    /// The helper running, if any. Held only to look: a helper starts under `starting`.
    connection: Mutex<Option<Arc<Connection>>>,
    starting: Mutex<()>,
    next_id: Arc<AtomicU64>,
    kept: Arc<Kept>,
}

/// What outlives one helper.
#[derive(Default)]
struct Kept {
    /// Told to each helper first.
    watched: Mutex<Option<(RepositoryInfo, OnChange)>>,
    hidden: AtomicBool,
    /// A helper stopped while the window was hidden: the repository on screen is read again
    /// when it shows.
    read_again: AtomicBool,
    /// No helper starts before then.
    not_before: Mutex<Option<Instant>>,
}

/// One helper process.
struct Connection {
    stdin: Mutex<ChildStdin>,
    replies: Arc<Replies>,
}

/// The requests waiting for their reply, until the helper stops.
#[derive(Default)]
struct Replies {
    waiting: Mutex<HashMap<u64, Sender<Incoming>>>,
    /// Set with `waiting` locked, so no request waits on a helper that stopped.
    stopped: AtomicBool,
}

enum Incoming {
    Contents(Vec<ContentFile>),
    Reply(Result<Box<RawValue>, WireError>),
}

impl Connection {
    fn write(&self, id: u64, request: Request) -> anyhow::Result<()> {
        write_frame(&mut *lock(&self.stdin), &RequestFrame { id, request })
            .context("could not write to the helper")
    }
}

impl AgentRepositories {
    pub fn new(start: impl Fn() -> Command + Send + Sync + 'static) -> Self {
        Self {
            start: Box::new(start),
            connection: Mutex::default(),
            starting: Mutex::default(),
            next_id: Arc::new(AtomicU64::new(1)),
            kept: Arc::default(),
        }
    }

    /// Sends `request` and waits for its reply, giving `contents` the files a search in contents
    /// finds meanwhile. Starts a helper if none runs.
    fn call<T: DeserializeOwned>(
        &self,
        request: Request,
        contents: &dyn Fn(Vec<ContentFile>),
    ) -> anyhow::Result<T> {
        let connection = match self.running() {
            Some(connection) => connection,
            None => self.start()?,
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        {
            let mut waiting = lock(&connection.replies.waiting);
            if connection.replies.stopped.load(Ordering::Relaxed) {
                anyhow::bail!("the helper stopped");
            }
            waiting.insert(id, sender);
        }
        if let Err(error) = connection.write(id, request) {
            lock(&connection.replies.waiting).remove(&id);
            return Err(error);
        }
        loop {
            match receiver.recv() {
                Ok(Incoming::Contents(files)) => contents(files),
                Ok(Incoming::Reply(Ok(value))) => return Ok(serde_json::from_str(value.get())?),
                Ok(Incoming::Reply(Err(error))) => return Err(error.into()),
                Err(_) => anyhow::bail!("the helper stopped"),
            }
        }
    }

    /// Sends `request` to the helper running without waiting, and starts none: what a helper
    /// must know is in `Kept`, told to the next one first.
    fn tell(&self, request: Request) {
        let Some(connection) = self.running() else {
            return;
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if let Err(error) = connection.write(id, request) {
            tracing::debug!(error = %format!("{error:#}"), "the helper was not told");
        }
    }

    fn running(&self) -> Option<Arc<Connection>> {
        lock(&self.connection)
            .as_ref()
            .filter(|c| !c.replies.stopped.load(Ordering::Relaxed))
            .cloned()
    }

    /// Starts a helper, unless another caller just did, or one failed too recently.
    fn start(&self) -> anyhow::Result<Arc<Connection>> {
        let _starting = lock(&self.starting);
        if let Some(connection) = self.running() {
            return Ok(connection);
        }
        if lock(&self.kept.not_before).is_some_and(|at| Instant::now() < at) {
            anyhow::bail!("the helper stopped; it starts again in a few seconds");
        }
        let connection = self.spawn().inspect_err(|_| {
            *lock(&self.kept.not_before) = Some(Instant::now() + STABLE_RUN);
        })?;
        // published before it is told anything: what changes meanwhile reaches it either way
        *lock(&self.connection) = Some(connection.clone());
        tell_kept(&connection, &self.kept, &self.next_id)?;
        Ok(connection)
    }

    fn spawn(&self) -> anyhow::Result<Arc<Connection>> {
        let mut command = (self.start)();
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let mut child = command.spawn().context("could not start the helper")?;
        let stdin = child.stdin.take().context("no stdin")?;
        let stdout = child.stdout.take().context("no stdout")?;
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log_line(&line);
                }
            });
        }
        tracing::info!(pid = child.id(), "helper started");
        let replies = Arc::new(Replies::default());
        let (read_replies, kept) = (replies.clone(), self.kept.clone());
        std::thread::spawn(move || read_messages(stdout, &read_replies, &kept, child));
        Ok(Arc::new(Connection {
            stdin: Mutex::new(stdin),
            replies,
        }))
    }
}

/// Tells a helper just started what the app keeps, as it is now: read under the lock its requests
/// are written with, so a change told meanwhile is never told before an older state.
fn tell_kept(connection: &Connection, kept: &Kept, next_id: &AtomicU64) -> anyhow::Result<()> {
    let mut stdin = lock(&connection.stdin);
    let mut tell = |request| {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        write_frame(&mut *stdin, &RequestFrame { id, request })
    };
    if kept.hidden.load(Ordering::Relaxed) {
        tell(Request::SetVisible { visible: false })?;
    }
    if let Some((repository, _)) = lock(&kept.watched).as_ref() {
        tell(Request::Watch {
            repository: Some(repository.clone()),
        })?;
    }
    Ok(())
}

/// Hands each message of the helper to whom waits for it, until the helper stops.
fn read_messages(stdout: ChildStdout, replies: &Replies, kept: &Kept, mut child: Child) {
    let started = Instant::now();
    let mut input = BufReader::new(stdout);
    loop {
        match read_frame::<Message>(&mut input) {
            Ok(Some(Message::Reply { id, result })) => {
                // one nobody waits for was told, not asked
                if let Some(sender) = lock(&replies.waiting).remove(&id) {
                    let _ = sender.send(Incoming::Reply(result));
                }
            }
            Ok(Some(Message::Contents { id, files })) => {
                if let Some(sender) = lock(&replies.waiting).get(&id) {
                    let _ = sender.send(Incoming::Contents(files));
                }
            }
            Ok(Some(Message::Changed(change))) => {
                if let Some(on_change) = watching(kept, &change.root) {
                    on_change(change);
                }
            }
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(%error, "the helper's output cannot be read: stopping it");
                let _ = child.kill();
                break;
            }
        }
    }
    // before it shows as stopped, so no request starts the next one too soon
    let stable = started.elapsed() >= STABLE_RUN;
    if !stable {
        *lock(&kept.not_before) = Some(Instant::now() + STABLE_RUN);
    }
    {
        let mut waiting = lock(&replies.waiting);
        replies.stopped.store(true, Ordering::Relaxed);
        // the requests waiting fail: their senders are dropped
        waiting.clear();
    }
    match child.wait() {
        Ok(status) => tracing::info!(%status, "helper stopped"),
        Err(error) => tracing::warn!(%error, "helper stopped"),
    }
    if !stable {
        return;
    }
    if kept.hidden.load(Ordering::Relaxed) {
        kept.read_again.store(true, Ordering::Relaxed);
    } else {
        read_again(kept);
    }
}

/// What gets the changes of the repository at `root`, if it is the one watched: one the helper
/// sent before it took the next watch is not.
fn watching(kept: &Kept, root: &str) -> Option<OnChange> {
    lock(&kept.watched)
        .as_ref()
        .filter(|(repository, _)| repository.root == root)
        .map(|(_, f)| f.clone())
}

/// What the helper that stopped watched may have changed meanwhile: the app reads it again, which
/// starts the next helper.
fn read_again(kept: &Kept) {
    let watched = lock(&kept.watched).clone();
    if let Some((repository, on_change)) = watched {
        on_change(RepositoryChange {
            root: repository.root.clone(),
            git_dir: true,
        });
    }
}

/// A line the helper logged, at its level in the app's log.
fn log_line(line: &str) {
    let line = line.trim();
    match line.split_whitespace().next() {
        Some("ERROR") => tracing::error!(target: "helper", "{line}"),
        Some("WARN") => tracing::warn!(target: "helper", "{line}"),
        Some("INFO") => tracing::info!(target: "helper", "{line}"),
        _ => tracing::debug!(target: "helper", "{line}"),
    }
}

fn nothing(_: Vec<ContentFile>) {}

impl Repositories for AgentRepositories {
    fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo> {
        let candidate = candidate.to_path_buf();
        self.call(Request::Resolve { candidate }, &nothing)
    }

    fn snapshot(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySnapshot> {
        let repository = info.clone();
        self.call(Request::Snapshot { repository }, &nothing)
    }

    fn summary(&self, info: &RepositoryInfo) -> anyhow::Result<RepositorySummary> {
        let repository = info.clone();
        self.call(Request::Summary { repository }, &nothing)
    }

    fn file_diff(
        &self,
        info: &RepositoryInfo,
        request: &FileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        let (repository, request) = (info.clone(), request.clone());
        self.call(
            Request::FileDiff {
                repository,
                request,
            },
            &nothing,
        )
    }

    fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits> {
        let repository = info.clone();
        self.call(Request::RecentCommits { repository }, &nothing)
    }

    fn commit_files(
        &self,
        info: &RepositoryInfo,
        commit: &CommitRequest,
    ) -> anyhow::Result<CommitFiles> {
        let (repository, commit) = (info.clone(), commit.clone());
        self.call(Request::CommitFiles { repository, commit }, &nothing)
    }

    fn commit_file_diff(
        &self,
        info: &RepositoryInfo,
        request: &CommitFileDiffRequest,
    ) -> anyhow::Result<UnifiedDiff> {
        let (repository, request) = (info.clone(), request.clone());
        self.call(
            Request::CommitFileDiff {
                repository,
                request,
            },
            &nothing,
        )
    }

    fn directory(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Directory> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::Directory { repository, path }, &nothing)
    }

    fn file_content(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileContent> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::FileContent { repository, path }, &nothing)
    }

    fn syntax_colors(
        &self,
        info: &RepositoryInfo,
        request: &SyntaxRequest,
    ) -> anyhow::Result<SyntaxColors> {
        let (repository, request) = (info.clone(), request.clone());
        self.call(
            Request::SyntaxColors {
                repository,
                request,
            },
            &nothing,
        )
    }

    fn search_files(&self, info: &RepositoryInfo, query: &str) -> Option<FileMatches> {
        let (repository, query) = (info.clone(), query.to_string());
        self.call::<Option<FileMatches>>(Request::SearchFiles { repository, query }, &nothing)
            .inspect_err(
                |error| tracing::debug!(error = %format!("{error:#}"), "no files to search"),
            )
            .ok()
            .flatten()
    }

    fn search_contents(
        &self,
        info: &RepositoryInfo,
        query: &str,
        send: &(dyn Fn(Vec<ContentFile>) + Sync),
    ) -> anyhow::Result<ContentEnd> {
        let (repository, query) = (info.clone(), query.to_string());
        self.call(Request::SearchContents { repository, query }, &send)
    }

    fn stop_content_search(&self) {
        self.tell(Request::StopContentSearch);
    }

    fn retain(&self, roots: &[String]) {
        let roots = roots.to_vec();
        self.tell(Request::Retain { roots });
    }

    fn watch(
        &self,
        repository: Option<&RepositoryInfo>,
        on_change: Box<dyn Fn(RepositoryChange) + Send + Sync>,
    ) {
        *lock(&self.kept.watched) = repository.map(|r| (r.clone(), OnChange::from(on_change)));
        let repository = repository.cloned();
        if let Err(error) = self.call::<()>(Request::Watch { repository }, &nothing) {
            tracing::warn!(error = %format!("{error:#}"), "the helper could not watch");
        }
    }

    /// Does not wait, as the window's visibility is told on the main thread: a change missed
    /// while hidden comes as a change of the repository watched.
    fn set_visible(&self, visible: bool) -> Option<String> {
        self.kept.hidden.store(!visible, Ordering::Relaxed);
        self.tell(Request::SetVisible { visible });
        if visible && self.kept.read_again.swap(false, Ordering::Relaxed) {
            read_again(&self.kept);
        }
        None
    }
}
