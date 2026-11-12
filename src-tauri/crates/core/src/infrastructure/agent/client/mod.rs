//! The app's side: a helper, a child process talking over its stdin and stdout (`protocol`),
//! asked what `Repositories` asks (`requests`). A helper that stops is started again on the next
//! request that waits for a reply, told first the repository watched and whether the window shows,
//! as they are then. Each helper is a `connection`, its output read by `output`; one that watches
//! nothing and was asked nothing for a while is closed by `idle`.

mod connection;
mod idle;
mod output;
mod requests;

use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde_json::value::RawValue;

use super::protocol::Request;
use crate::modules::folder::{RepositoryChange, RepositoryInfo};
use crate::modules::reader::OnChange;
use crate::modules::search::ContentFile;
use crate::shared::error::{user_facing_code, UserFacingError, UserFacingErrorCode};
use crate::shared::sync::lock;
use connection::{Connection, Incoming};
use idle::{close_when_idle, Idle, IDLE_EXIT};
use output::read_again;

/// A helper that stops, or cannot start, sooner than this is not started again before this long:
/// one failing at once would otherwise be started at every request. One that ran longer makes
/// the app read the repository on screen again, which starts the next.
const STABLE_RUN: Duration = Duration::from_secs(10);

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

/// What a request is answered with: a value as JSON, or bytes as they are (an image).
enum Answer {
    Value(Box<RawValue>),
    Bytes(Vec<u8>),
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
            idle: Arc::new(Idle::new(after)),
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

    /// How the helper's WSL distro names `windows`, a path of Windows (`wslpath -u`, run there).
    /// Starts a helper if none runs.
    pub fn linux_path(&self, windows: &str) -> anyhow::Result<String> {
        let windows = windows.to_string();
        self.call(Request::LinuxPath { windows }, &nothing)
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
        let spawned = (self.start)().and_then(|command| Connection::spawn(command, &self.kept));
        let connection = spawned.map_err(|error| {
            let error = helper_failed(error);
            let code = user_facing_code(&error).unwrap_or(UserFacingErrorCode::HelperFailed);
            *lock(&self.kept.not_before) = Some((Instant::now() + STABLE_RUN, code));
            error
        })?;
        // published before it is told anything: what changes meanwhile reaches it either way
        *lock(&self.connection) = Some(connection.clone());
        connection
            .tell_kept(&self.kept, &self.next_id)
            .map_err(helper_failed)?;
        Ok(connection)
    }

    /// `Repositories::watch`: kept, to tell each helper first, and told to the one running.
    fn tell_watch(&self, repository: Option<&RepositoryInfo>, on_change: OnChange) {
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

    /// `Repositories::set_visible`. Does not wait, as the window's visibility is told on the main
    /// thread: a change missed while hidden comes as a change of the repository watched.
    fn tell_visible(&self, visible: bool) {
        self.kept.hidden.store(!visible, Ordering::Relaxed);
        self.tell(Request::SetVisible { visible });
        if visible && self.kept.read_again.swap(false, Ordering::Relaxed) {
            read_again(&self.kept);
        }
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

/// A helper that could not start, or stopped, as the user is told it (`helper_failed`); a failure
/// with a code of its own, such as a WSL distro gone, keeps it.
fn helper_failed(error: anyhow::Error) -> anyhow::Error {
    if user_facing_code(&error).is_some() {
        return error;
    }
    error.context(UserFacingError::new(UserFacingErrorCode::HelperFailed))
}

/// For a request that streams nothing before its reply.
fn nothing(_: Vec<ContentFile>) {}
