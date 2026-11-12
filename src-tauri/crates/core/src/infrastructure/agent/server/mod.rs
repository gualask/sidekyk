//! The helper's side: reads the app's requests and answers each, sending up what the watcher
//! sees. What is quick and depends on the order of arrival is answered as it comes; a watch,
//! which can take a while (on Linux it walks the tree), on one thread in that order too; anything
//! else on a thread of its own. Ends when the app closes the stream. What it writes is
//! `server_output`'s.

mod output;

use std::io::{BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Context;

use super::protocol::{read_frame, Message, Request, RequestFrame};
use crate::infrastructure::process;
use crate::modules::folder::{RepositoryChange, RepositoryInfo};
use crate::modules::reader::{LocalRepositories, Repositories};
use output::{guarded, reply, reply_image, send_message, value, Output, Reply};

pub fn serve(
    repositories: Arc<LocalRepositories>,
    input: impl Read,
    output: impl Write + Send + 'static,
) -> anyhow::Result<()> {
    let output: Output = Arc::new(Mutex::new(Box::new(output)));
    let mut input = BufReader::new(input);
    while let Some(RequestFrame { id, request }) = read_frame(&mut input)? {
        tracing::debug!(id, request = request_name(&request), "request");
        answer(&repositories, &output, id, request);
    }
    Ok(())
}

/// What a thread of its own answers a request with, given the repositories.
type Work = Box<dyn FnOnce(&LocalRepositories) -> Reply + Send>;

/// Answers request `id`: what is quick and depends on the order of arrival at once, the rest on
/// a thread of its own.
fn answer(repositories: &Arc<LocalRepositories>, output: &Output, id: u64, request: Request) {
    let on_thread = |work: Work| reply_on_thread(repositories, output, id, work);
    match request {
        Request::StopContentSearch => {
            repositories.stop_content_search();
            reply(output, id, value(()));
        }
        // the app does not wait: a change missed while hidden comes up as one
        Request::SetVisible { visible } => {
            set_visible(repositories, output, visible);
            reply(output, id, value(()));
        }
        Request::Retain { roots } => {
            repositories.retain(&roots);
            reply(output, id, value(()));
        }
        Request::Watch { repository } => watch(repositories, output, id, repository),
        Request::SearchContents { repository, query } => {
            search_contents(repositories, output, id, repository, query);
        }
        Request::Resolve { candidate } => {
            on_thread(Box::new(move |r| value(r.resolve(&candidate)?)));
        }
        Request::RepositoriesInside { folder } => {
            on_thread(Box::new(move |r| value(r.repositories_inside(&folder)?)));
        }
        Request::FolderKind { repository } => {
            on_thread(Box::new(move |r| value(r.folder_kind(&repository)?)));
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
        Request::ChangesIgnoringWhitespace { repository } => {
            on_thread(Box::new(move |r| {
                value(r.changes_ignoring_whitespace(&repository)?)
            }));
        }
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
        Request::RecentFiles { repository } => {
            on_thread(Box::new(move |r| value(r.recent_files(&repository)?)));
        }
        Request::FileContent { repository, path } => {
            on_thread(Box::new(move |r| {
                value(r.file_content(&repository, &path)?)
            }));
        }
        Request::FileStamp { repository, path } => {
            on_thread(Box::new(move |r| value(r.file_stamp(&repository, &path)?)));
        }
        Request::TreeHoldsNow { repository, path } => {
            on_thread(Box::new(move |r| {
                value(r.tree_holds_now(&repository, &path)?)
            }));
        }
        Request::Image {
            repository,
            path,
            blob,
        } => image(repositories, output, id, repository, path, blob),
        Request::BlobSize { repository, blob } => {
            on_thread(Box::new(move |r| value(r.blob_size(&repository, &blob)?)));
        }
        Request::MarkdownPreview { repository, path } => {
            on_thread(Box::new(move |r| {
                value(r.markdown_preview(&repository, &path)?)
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
        Request::LinuxPath { windows } => {
            on_thread(Box::new(move |_| value(linux_path(&windows)?)));
        }
    }
}

/// `work`'s reply to request `id`, on a thread of its own.
fn reply_on_thread(repositories: &Arc<LocalRepositories>, output: &Output, id: u64, work: Work) {
    let (repositories, output) = (repositories.clone(), output.clone());
    std::thread::spawn(move || reply(&output, id, guarded(|| work(&repositories))));
}

/// A watch, on a thread of its own: its turn is taken here, so two watches in a row end on the
/// last whichever thread runs first. The changes it sees go up as they come.
fn watch(
    repositories: &Arc<LocalRepositories>,
    output: &Output,
    id: u64,
    repository: Option<RepositoryInfo>,
) {
    let turn = repositories.next_watch();
    let changes = output.clone();
    reply_on_thread(
        repositories,
        output,
        id,
        Box::new(move |r| {
            let on_change = Box::new(move |event| send_message(&changes, &Message::Changed(event)));
            r.watch_in_turn(turn, repository.as_ref(), on_change);
            value(())
        }),
    );
}

/// A search in contents, on a thread of its own: its turn is taken here, so a newer search stops
/// it whichever thread runs first. The files it finds go up as they come, before its reply.
fn search_contents(
    repositories: &Arc<LocalRepositories>,
    output: &Output,
    id: u64,
    repository: RepositoryInfo,
    query: String,
) {
    let run = repositories.next_content_search();
    let contents = output.clone();
    reply_on_thread(
        repositories,
        output,
        id,
        Box::new(move |r| {
            let send = |files| send_message(&contents, &Message::Contents { id, files });
            value(r.search_contents_in_turn(run, &repository, &query, &send)?)
        }),
    );
}

/// An image, on a thread of its own, its bytes sent as they are (`reply_image`).
fn image(
    repositories: &Arc<LocalRepositories>,
    output: &Output,
    id: u64,
    repository: RepositoryInfo,
    path: String,
    blob: Option<String>,
) {
    let (repositories, output) = (repositories.clone(), output.clone());
    std::thread::spawn(move || {
        let image = guarded(|| repositories.image(&repository, &path, blob.as_deref()));
        reply_image(&output, id, image);
    });
}

/// Tells the watcher whether the window shows: a change it missed while hidden is sent as one.
fn set_visible(repositories: &LocalRepositories, output: &Output, visible: bool) {
    if let Some(root) = repositories.set_visible(visible) {
        let event = RepositoryChange::anything(root);
        send_message(output, &Message::Changed(event));
    }
}

/// `wslpath` reads no disk: it answers at once, or is stuck.
const WSLPATH_TIMEOUT: Duration = Duration::from_secs(10);
const WSLPATH_MAX_OUTPUT: usize = 64 * 1024;

/// How this WSL distro names a path of Windows (`wslpath -u`): `/mnt/c/…` for `C:\…` unless the
/// distro mounts drives elsewhere. Run inside the distro, it costs no `wsl.exe` on Windows' side.
fn linux_path(windows: &str) -> anyhow::Result<String> {
    let mut command = Command::new("wslpath");
    command
        .args(["-u", windows])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = process::run(&mut command, None, WSLPATH_MAX_OUTPUT, WSLPATH_TIMEOUT)
        .context("could not run wslpath")?;
    anyhow::ensure!(output.code == 0, "wslpath failed: {}", output.stderr.trim());
    let linux = String::from_utf8(output.stdout).context("wslpath wrote no UTF-8")?;
    Ok(linux.trim_end_matches(['\n', '\r']).to_string())
}

/// Its name in the log, without what may be long (a path, a query).
fn request_name(request: &Request) -> &'static str {
    match request {
        Request::Resolve { .. } => "resolve",
        Request::RepositoriesInside { .. } => "repositoriesInside",
        Request::FolderKind { .. } => "folderKind",
        Request::Snapshot { .. } => "snapshot",
        Request::Summary { .. } => "summary",
        Request::FileDiff { .. } => "fileDiff",
        Request::ChangesIgnoringWhitespace { .. } => "changesIgnoringWhitespace",
        Request::RecentCommits { .. } => "recentCommits",
        Request::CommitActivity { .. } => "commitActivity",
        Request::CommitFiles { .. } => "commitFiles",
        Request::CommitFileDiff { .. } => "commitFileDiff",
        Request::Directory { .. } => "directory",
        Request::RecentFiles { .. } => "recentFiles",
        Request::FileContent { .. } => "fileContent",
        Request::MarkdownPreview { .. } => "markdownPreview",
        Request::FileStamp { .. } => "fileStamp",
        Request::TreeHoldsNow { .. } => "treeHoldsNow",
        Request::Image { .. } => "image",
        Request::BlobSize { .. } => "blobSize",
        Request::SyntaxColors { .. } => "syntaxColors",
        Request::SearchFiles { .. } => "searchFiles",
        Request::SearchContents { .. } => "searchContents",
        Request::StopContentSearch => "stopContentSearch",
        Request::Retain { .. } => "retain",
        Request::Watch { .. } => "watch",
        Request::SetVisible { .. } => "setVisible",
        Request::LinuxPath { .. } => "linuxPath",
    }
}
