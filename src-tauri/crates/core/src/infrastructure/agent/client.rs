//! The app's side: `Repositories` through a helper, a child process talking over its stdin and
//! stdout (`protocol`). A helper that stops is started again on the next request that waits for a
//! reply, told first the repository watched and whether the window shows, as they are then. One
//! that watches nothing and was asked nothing for a while is closed.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::Context;
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;

use super::protocol::{
    read_bytes, read_frame, write_frame, Message, Request, RequestFrame, WireError,
};
use crate::infrastructure::hide_console;
use crate::modules::folder::FolderKind;
use crate::modules::preview::MarkdownDocument;
use crate::modules::repositories::{OnChange, Repositories};
use crate::modules::repository::{
    ChangesIgnoringWhitespace, CommitActivity, CommitFileDiffRequest, CommitFiles, CommitRequest,
    Directory, FileContent, FileDiffRequest, FileStamp, RecentCommits, RepositoryChange,
    RepositoryInfo, RepositorySnapshot, RepositorySummary, UnifiedDiff,
};
use crate::modules::search::{ContentEnd, ContentFile, FileMatches};
use crate::modules::syntax::{SyntaxColors, SyntaxRequest};
use crate::shared::error::{user_facing_code, UserFacingError, UserFacingErrorCode};
use crate::shared::sync::lock;

/// A helper that stops, or cannot start, sooner than this is not started again before this long:
/// one failing at once would otherwise be started at every request. One that ran longer makes
/// the app read the repository on screen again, which starts the next.
const STABLE_RUN: Duration = Duration::from_secs(10);

/// How long a helper that watches nothing lives after its last request: a pause, or the projects'
/// cards read again, never waits for a new one; a WSL distro it keeps running for that long is
/// fine (`docs/features/wsl.md`, Lifecycle).
const IDLE_EXIT: Duration = Duration::from_secs(10 * 60);

/// A watch's `OnChange`, shared with the thread reading the helper's messages.
type SharedOnChange = Arc<dyn Fn(RepositoryChange) + Send + Sync>;

/// How a helper starts: the command, once whatever it needs is ready (installed in a distro).
type Start = Box<dyn Fn() -> anyhow::Result<Command> + Send + Sync>;

/// The helper running, if any. Held only to look: a helper starts under `starting`.
type Slot = Arc<Mutex<Option<Arc<Connection>>>>;

pub struct AgentRepositories {
    /// The local binary, or `wsl.exe` running it in a distro.
    start: Start,
    connection: Slot,
    starting: Mutex<()>,
    next_id: Arc<AtomicU64>,
    kept: Arc<Kept>,
    idle: Arc<Idle>,
}

/// When the helper was last asked something, for the thread that closes it once idle.
struct Idle {
    after: Duration,
    state: Mutex<IdleState>,
    /// Told when a request ends, the repository watched changes, or the client goes.
    changed: Condvar,
}

struct IdleState {
    /// Requests waiting for their reply: a helper is not idle while one does.
    busy: usize,
    last: Instant,
    /// The client went: the thread ends.
    gone: bool,
}

/// What outlives one helper.
#[derive(Default)]
struct Kept {
    /// Told to each helper first.
    watched: Mutex<Option<(RepositoryInfo, SharedOnChange)>>,
    hidden: AtomicBool,
    /// A helper stopped while the window was hidden: the repository on screen is read again
    /// when it shows.
    read_again: AtomicBool,
    /// No helper starts before then; meanwhile a request fails as the last start did.
    not_before: Mutex<Option<(Instant, UserFacingErrorCode)>>,
}

/// One helper process.
struct Connection {
    /// `None` once closed: the helper reads the end of its input and exits.
    stdin: Mutex<Option<ChildStdin>>,
    replies: Arc<Replies>,
}

/// The requests waiting for their reply, until the helper stops.
#[derive(Default)]
struct Replies {
    waiting: Mutex<HashMap<u64, Sender<Incoming>>>,
    /// Set with `waiting` locked, so no request waits on a helper that stopped.
    stopped: AtomicBool,
    /// The app closed it, idle: nothing to read again, nothing to wait for before the next.
    closed: AtomicBool,
}

enum Incoming {
    Contents(Vec<ContentFile>),
    Reply(Result<Box<RawValue>, WireError>),
    Bytes(Vec<u8>),
}

/// What a request is answered with: a value as JSON, or bytes as they are (an image).
enum Answer {
    Value(Box<RawValue>),
    Bytes(Vec<u8>),
}

impl Connection {
    fn write(&self, id: u64, request: Request) -> anyhow::Result<()> {
        let mut stdin = lock(&self.stdin);
        let stdin = stdin.as_mut().context("the helper was closed")?;
        write_frame(stdin, &RequestFrame { id, request }).context("could not write to the helper")
    }

    fn close(&self) {
        self.replies.closed.store(true, Ordering::Relaxed);
        lock(&self.stdin).take();
    }
}

impl AgentRepositories {
    /// A client that closes its helper `IDLE_EXIT` after its last request, when it watches nothing.
    pub fn new(start: impl Fn() -> anyhow::Result<Command> + Send + Sync + 'static) -> Self {
        Self::closing_after(IDLE_EXIT, start)
    }

    /// As `new`, closing an idle helper after `after`.
    pub fn closing_after(
        after: Duration,
        start: impl Fn() -> anyhow::Result<Command> + Send + Sync + 'static,
    ) -> Self {
        let this = Self {
            start: Box::new(start),
            connection: Slot::default(),
            starting: Mutex::default(),
            next_id: Arc::new(AtomicU64::new(1)),
            kept: Arc::default(),
            idle: Arc::new(Idle {
                after,
                state: Mutex::new(IdleState {
                    busy: 0,
                    last: Instant::now(),
                    gone: false,
                }),
                changed: Condvar::new(),
            }),
        };
        let (idle, slot, kept) = (
            this.idle.clone(),
            this.connection.clone(),
            this.kept.clone(),
        );
        std::thread::spawn(move || close_when_idle(&idle, &slot, &kept));
        this
    }

    /// Sends `request` and waits for its reply, giving `contents` the files a search in contents
    /// finds meanwhile. Starts a helper if none runs.
    fn call<T: DeserializeOwned>(
        &self,
        request: Request,
        contents: &dyn Fn(Vec<ContentFile>),
    ) -> anyhow::Result<T> {
        match self.answer(request, contents)? {
            Answer::Value(value) => Ok(serde_json::from_str(value.get())?),
            Answer::Bytes(_) => anyhow::bail!("the helper answered with bytes"),
        }
    }

    /// As `call`, for a request answered with bytes.
    fn call_bytes(&self, request: Request) -> anyhow::Result<Vec<u8>> {
        match self.answer(request, &nothing)? {
            Answer::Bytes(bytes) => Ok(bytes),
            Answer::Value(_) => anyhow::bail!("the helper answered without bytes"),
        }
    }

    fn answer(
        &self,
        request: Request,
        contents: &dyn Fn(Vec<ContentFile>),
    ) -> anyhow::Result<Answer> {
        lock(&self.idle.state).busy += 1;
        let result = self.ask(request, contents);
        self.idle.touch(|state| state.busy -= 1);
        result
    }

    fn ask(&self, request: Request, contents: &dyn Fn(Vec<ContentFile>)) -> anyhow::Result<Answer> {
        let connection = match self.running() {
            Some(connection) => connection,
            None => self.start()?,
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        {
            let mut waiting = lock(&connection.replies.waiting);
            if connection.replies.stopped.load(Ordering::Relaxed) {
                return Err(helper_failed(anyhow::anyhow!("the helper stopped")));
            }
            waiting.insert(id, sender);
        }
        if let Err(error) = connection.write(id, request) {
            lock(&connection.replies.waiting).remove(&id);
            return Err(helper_failed(error));
        }
        loop {
            match receiver.recv() {
                Ok(Incoming::Contents(files)) => contents(files),
                Ok(Incoming::Reply(Ok(value))) => return Ok(Answer::Value(value)),
                Ok(Incoming::Bytes(bytes)) => return Ok(Answer::Bytes(bytes)),
                Ok(Incoming::Reply(Err(error))) => return Err(error.into()),
                Err(_) => return Err(helper_failed(anyhow::anyhow!("the helper stopped"))),
            }
        }
    }

    /// Whether a helper runs now: a request would not start one.
    pub fn is_running(&self) -> bool {
        self.running().is_some()
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
        let waiting = *lock(&self.kept.not_before);
        if let Some((at, code)) = waiting.filter(|(at, _)| Instant::now() < *at) {
            let error = anyhow::anyhow!("the helper starts again in {:?}", at - Instant::now());
            return Err(error.context(UserFacingError::new(code)));
        }
        let connection = self.spawn().map_err(|error| {
            let error = helper_failed(error);
            let code = user_facing_code(&error).unwrap_or(UserFacingErrorCode::HelperFailed);
            *lock(&self.kept.not_before) = Some((Instant::now() + STABLE_RUN, code));
            error
        })?;
        // published before it is told anything: what changes meanwhile reaches it either way
        *lock(&self.connection) = Some(connection.clone());
        tell_kept(&connection, &self.kept, &self.next_id).map_err(helper_failed)?;
        Ok(connection)
    }

    fn spawn(&self) -> anyhow::Result<Arc<Connection>> {
        let mut command = (self.start)()?;
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
            stdin: Mutex::new(Some(stdin)),
            replies,
        }))
    }
}

impl Drop for AgentRepositories {
    fn drop(&mut self) {
        self.idle.touch(|state| state.gone = true);
        if let Some(connection) = lock(&self.connection).take() {
            connection.close();
        }
    }
}

impl Idle {
    /// Changes the state, as of now, and tells the thread.
    fn touch(&self, change: impl FnOnce(&mut IdleState)) {
        let mut state = lock(&self.state);
        change(&mut state);
        state.last = Instant::now();
        self.changed.notify_one();
    }
}

/// Closes the helper once it has watched nothing and been asked nothing for `idle.after`. Sleeps
/// until then, or until something changes: no wake-up while there is nothing to close.
fn close_when_idle(idle: &Idle, slot: &Mutex<Option<Arc<Connection>>>, kept: &Kept) {
    let mut state = lock(&idle.state);
    loop {
        if state.gone {
            return;
        }
        let running = lock(slot)
            .as_ref()
            .is_some_and(|c| !c.replies.stopped.load(Ordering::Relaxed));
        let watching = lock(&kept.watched).is_some();
        if !running || watching || state.busy > 0 {
            state = idle
                .changed
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
            continue;
        }
        let deadline = state.last + idle.after;
        let now = Instant::now();
        if now < deadline {
            state = idle
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
            continue;
        }
        let taken = lock(slot).take();
        if let Some(connection) = taken {
            // closed with no lock held: a write stuck on a full pipe holds only its own
            drop(state);
            tracing::info!("helper idle: closing it");
            connection.close();
            state = lock(&idle.state);
        }
    }
}

/// A helper that could not start, or stopped, as the user is told it (`helper_failed`); a failure
/// with a code of its own, such as a WSL distro gone, keeps it.
fn helper_failed(error: anyhow::Error) -> anyhow::Error {
    if user_facing_code(&error).is_some() {
        return error;
    }
    error.context(UserFacingError::new(UserFacingErrorCode::HelperFailed))
}

/// Tells a helper just started what the app keeps, as it is now: read under the lock its requests
/// are written with, so a change told meanwhile is never told before an older state.
fn tell_kept(connection: &Connection, kept: &Kept, next_id: &AtomicU64) -> anyhow::Result<()> {
    let mut stdin = lock(&connection.stdin);
    let stdin = stdin.as_mut().context("the helper was closed")?;
    let mut tell = |request| {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        write_frame(stdin, &RequestFrame { id, request })
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
            Ok(Some(Message::Bytes { id })) => match read_bytes(&mut input) {
                Ok(bytes) => {
                    if let Some(sender) = lock(&replies.waiting).remove(&id) {
                        let _ = sender.send(Incoming::Bytes(bytes));
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "the helper's output cannot be read: stopping it");
                    let _ = child.kill();
                    break;
                }
            },
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
    let closed = replies.closed.load(Ordering::Relaxed);
    let stable = closed || started.elapsed() >= STABLE_RUN;
    if !stable {
        let code = UserFacingErrorCode::HelperFailed;
        *lock(&kept.not_before) = Some((Instant::now() + STABLE_RUN, code));
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
    if closed || !stable {
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
fn watching(kept: &Kept, root: &str) -> Option<SharedOnChange> {
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
        on_change(RepositoryChange::anything(repository.root.clone()));
    }
}

/// A line the helper logged, at its level in the app's log.
fn log_line(line: &str) {
    let line = line.trim();
    match line.split_whitespace().next() {
        Some("ERROR") => tracing::error!(target: "helper", "{line}"),
        Some("WARN") => tracing::warn!(target: "helper", "{line}"),
        Some("INFO") => tracing::info!(target: "helper", "{line}"),
        // a panic writes no level: it is the helper failing, kept in every build
        _ if line.contains("panicked") => tracing::error!(target: "helper", "{line}"),
        _ => tracing::debug!(target: "helper", "{line}"),
    }
}

fn nothing(_: Vec<ContentFile>) {}

impl Repositories for AgentRepositories {
    fn resolve(&self, candidate: &Path) -> anyhow::Result<RepositoryInfo> {
        let candidate = candidate.to_path_buf();
        self.call(Request::Resolve { candidate }, &nothing)
    }

    fn folder_kind(&self, info: &RepositoryInfo) -> anyhow::Result<FolderKind> {
        let repository = info.clone();
        self.call(Request::FolderKind { repository }, &nothing)
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

    fn changes_ignoring_whitespace(
        &self,
        info: &RepositoryInfo,
    ) -> anyhow::Result<ChangesIgnoringWhitespace> {
        let repository = info.clone();
        self.call(Request::ChangesIgnoringWhitespace { repository }, &nothing)
    }

    fn recent_commits(&self, info: &RepositoryInfo) -> anyhow::Result<RecentCommits> {
        let repository = info.clone();
        self.call(Request::RecentCommits { repository }, &nothing)
    }

    fn commit_activity(&self, info: &RepositoryInfo, since: i64) -> anyhow::Result<CommitActivity> {
        let repository = info.clone();
        self.call(Request::CommitActivity { repository, since }, &nothing)
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

    fn file_stamp(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<FileStamp> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::FileStamp { repository, path }, &nothing)
    }

    fn image(&self, info: &RepositoryInfo, path: &str) -> anyhow::Result<Vec<u8>> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call_bytes(Request::Image { repository, path })
    }

    fn markdown_preview(
        &self,
        info: &RepositoryInfo,
        path: &str,
    ) -> anyhow::Result<Option<MarkdownDocument>> {
        let (repository, path) = (info.clone(), path.to_string());
        self.call(Request::MarkdownPreview { repository, path }, &nothing)
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

    fn watch(&self, repository: Option<&RepositoryInfo>, on_change: OnChange) {
        let mut kept = lock(&self.kept.watched);
        // the repository watched already keeps its first `on_change`, as `Repositories` says
        let same = |(watched, _): &(RepositoryInfo, SharedOnChange)| {
            repository.is_some_and(|r| r.root == watched.root)
        };
        if kept.as_ref().is_some_and(same) {
            return;
        }
        let watched = repository.map(|r| (r.clone(), SharedOnChange::from(on_change)));
        let was_watching = std::mem::replace(&mut *kept, watched).is_some();
        drop(kept);
        // never waits, nor starts a helper (the caller may be the main thread, and a WSL distro
        // slow to start): the next one is told first, and a read of the repository starts it
        self.tell(Request::Watch {
            repository: repository.cloned(),
        });
        // idle from now once it watches nothing; a switch elsewhere does not keep it alive
        if was_watching || repository.is_some() {
            self.idle.touch(|_| {});
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
