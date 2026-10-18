//! The helper's side: reads the app's requests and answers each, sending up what the watcher
//! sees. What is quick and depends on the order of arrival is answered as it comes; a watch,
//! which can take a while (on Linux it walks the tree), on one thread in that order too; anything
//! else on a thread of its own. Ends when the app closes the stream.

use std::io::{self, BufReader, Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::value::RawValue;

use super::protocol::{read_frame, write_frame, Message, Request, RequestFrame, WireError};
use crate::modules::repositories::{LocalRepositories, Repositories};
use crate::modules::repository::{RepositoryChange, RepositoryInfo};
use crate::shared::sync::lock;

/// Where every thread writes its frames, one whole frame at a time.
type Output = Arc<Mutex<Box<dyn Write + Send>>>;

pub fn serve(
    repositories: Arc<LocalRepositories>,
    input: impl Read,
    output: impl Write + Send + 'static,
) -> anyhow::Result<()> {
    let output: Output = Arc::new(Mutex::new(Box::new(output)));
    let watches = watch_in_order(repositories.clone(), output.clone());
    let mut input = BufReader::new(input);
    while let Some(RequestFrame { id, request }) = read_frame(&mut input)? {
        tracing::debug!(id, request = request_name(&request), "request");
        let on_thread = |work: Box<dyn FnOnce(&LocalRepositories) -> Reply + Send>| {
            let (repositories, output) = (repositories.clone(), output.clone());
            std::thread::spawn(move || reply(&output, id, guarded(|| work(&repositories))));
        };
        match request {
            Request::StopContentSearch => {
                repositories.stop_content_search();
                reply(&output, id, value(()));
            }
            // the app does not wait: a change missed while hidden comes up as one
            Request::SetVisible { visible } => {
                if let Some(root) = repositories.set_visible(visible) {
                    let event = RepositoryChange {
                        root,
                        git_dir: true,
                    };
                    send_message(&output, &Message::Changed(event));
                }
                reply(&output, id, value(()));
            }
            Request::Retain { roots } => {
                repositories.retain(&roots);
                reply(&output, id, value(()));
            }
            Request::Watch { repository } => {
                // the thread watching is gone only if a watch panicked
                if watches.send((id, repository)).is_err() {
                    reply(&output, id, Err(anyhow::anyhow!("the helper cannot watch")));
                }
            }
            // its turn is taken here, so a newer search stops it whichever thread runs first
            Request::SearchContents { repository, query } => {
                let run = repositories.next_content_search();
                let contents = output.clone();
                on_thread(Box::new(move |r| {
                    let send = |files| send_message(&contents, &Message::Contents { id, files });
                    value(r.search_contents_in_turn(run, &repository, &query, &send)?)
                }));
            }
            Request::Resolve { candidate } => {
                on_thread(Box::new(move |r| value(r.resolve(&candidate)?)));
            }
            Request::Snapshot { repository } => {
                on_thread(Box::new(move |r| value(r.snapshot(&repository)?)));
            }
            Request::Summary { repository } => {
                on_thread(Box::new(move |r| value(r.summary(&repository)?)));
            }
            Request::FileDiff {
                repository,
                request,
            } => on_thread(Box::new(move |r| {
                value(r.file_diff(&repository, &request)?)
            })),
            Request::RecentCommits { repository } => {
                on_thread(Box::new(move |r| value(r.recent_commits(&repository)?)));
            }
            Request::CommitActivity { repository, since } => {
                on_thread(Box::new(move |r| {
                    value(r.commit_activity(&repository, since)?)
                }));
            }
            Request::CommitFiles { repository, commit } => {
                on_thread(Box::new(move |r| {
                    value(r.commit_files(&repository, &commit)?)
                }));
            }
            Request::CommitFileDiff {
                repository,
                request,
            } => on_thread(Box::new(move |r| {
                value(r.commit_file_diff(&repository, &request)?)
            })),
            Request::Directory { repository, path } => {
                on_thread(Box::new(move |r| value(r.directory(&repository, &path)?)));
            }
            Request::FileContent { repository, path } => {
                on_thread(Box::new(move |r| {
                    value(r.file_content(&repository, &path)?)
                }));
            }
            Request::SyntaxColors {
                repository,
                request,
            } => on_thread(Box::new(move |r| {
                value(r.syntax_colors(&repository, &request)?)
            })),
            Request::SearchFiles { repository, query } => {
                on_thread(Box::new(move |r| {
                    value(r.search_files(&repository, &query))
                }));
            }
        }
    }
    Ok(())
}

/// A request's answer, as JSON.
type Reply = anyhow::Result<Box<RawValue>>;

fn value(value: impl Serialize) -> Reply {
    Ok(serde_json::value::to_raw_value(&value)?)
}

/// The thread that starts and stops watching, one request after the other as they came: two
/// watches in a row must end on the last one.
fn watch_in_order(
    repositories: Arc<LocalRepositories>,
    output: Output,
) -> mpsc::Sender<(u64, Option<RepositoryInfo>)> {
    let (sender, receiver) = mpsc::channel::<(u64, Option<RepositoryInfo>)>();
    std::thread::spawn(move || {
        for (id, repository) in receiver {
            let changes = output.clone();
            let watched = guarded(|| {
                repositories.watch(
                    repository.as_ref(),
                    Box::new(move |event| send_message(&changes, &Message::Changed(event))),
                );
                value(())
            });
            reply(&output, id, watched);
        }
    });
    sender
}

/// `work`'s answer, or a failure if it panicked: the app waits for every reply.
fn guarded(work: impl FnOnce() -> Reply) -> Reply {
    catch_unwind(AssertUnwindSafe(work))
        .unwrap_or_else(|_| Err(anyhow::anyhow!("the helper failed on this request")))
}

fn reply(output: &Output, id: u64, result: Reply) {
    let result = result.map_err(|error| WireError::from(&error));
    if let Err(error) = write_message(output, &Message::Reply { id, result }) {
        // the app waits for this reply: a smaller one says why it cannot have it
        if error.kind() == io::ErrorKind::InvalidInput {
            let error = WireError::from(&anyhow::anyhow!("the answer is too long to send"));
            send_message(
                output,
                &Message::Reply {
                    id,
                    result: Err(error),
                },
            );
        }
    }
}

fn write_message(output: &Output, message: &Message) -> io::Result<()> {
    write_frame(&mut *lock(output), message)
}

fn send_message(output: &Output, message: &Message) {
    // the app went away: the read loop ends on its own
    if let Err(error) = write_message(output, message) {
        tracing::debug!(%error, "could not write to the app");
    }
}

/// Its name in the log, without what may be long (a path, a query).
fn request_name(request: &Request) -> &'static str {
    match request {
        Request::Resolve { .. } => "resolve",
        Request::Snapshot { .. } => "snapshot",
        Request::Summary { .. } => "summary",
        Request::FileDiff { .. } => "fileDiff",
        Request::RecentCommits { .. } => "recentCommits",
        Request::CommitActivity { .. } => "commitActivity",
        Request::CommitFiles { .. } => "commitFiles",
        Request::CommitFileDiff { .. } => "commitFileDiff",
        Request::Directory { .. } => "directory",
        Request::FileContent { .. } => "fileContent",
        Request::SyntaxColors { .. } => "syntaxColors",
        Request::SearchFiles { .. } => "searchFiles",
        Request::SearchContents { .. } => "searchContents",
        Request::StopContentSearch => "stopContentSearch",
        Request::Retain { .. } => "retain",
        Request::Watch { .. } => "watch",
        Request::SetVisible { .. } => "setVisible",
    }
}
