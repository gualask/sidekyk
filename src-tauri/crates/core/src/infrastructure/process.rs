//! A child process run within limits: its output read up to a size, the whole within a time.

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use anyhow::Context;

/// What a child writes to stderr past this is read and dropped: its start says what went wrong.
const MAX_STDERR_BYTES: usize = 64 * 1024;

/// What a child wrote, and how it ended.
pub(crate) struct Output {
    /// -1 when it was killed: it wrote more than the call reads.
    pub(crate) code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: String,
    /// It wrote more than `max_stdout` bytes: `stdout` is its first `max_stdout`, cut anywhere.
    pub(crate) truncated: bool,
}

/// The child did not end in time, and was killed.
#[derive(Debug, thiserror::Error)]
#[error("the process did not end in time and was killed")]
pub(crate) struct TimedOut;

/// Runs `command`, writing `input` to it, and reads its output within `max_stdout` bytes and
/// `timeout`. Each pipe is read on a thread of its own, so the caller can give up on both: a
/// reader left behind ends when the pipe closes. Past `max_stdout` the child is killed and its
/// output comes back cut; past `timeout` it is killed and the call fails.
pub(crate) fn run(
    command: &mut Command,
    input: Option<&[u8]>,
    max_stdout: usize,
    timeout: Duration,
) -> anyhow::Result<Output> {
    let deadline = Instant::now() + timeout;
    let mut child = command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .spawn()?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        // written apart, so a large output cannot block the child while we still write; closed
        // once written, which ends its input
        let input = input.to_vec();
        std::thread::spawn(move || stdin.write_all(&input));
    }
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        kill(&mut child);
        anyhow::bail!("the output is not piped");
    };
    let (sender, pipes) = mpsc::channel();
    let to_stdout = sender.clone();
    std::thread::spawn(move || to_stdout.send(Pipe::Stdout(read_stdout(stdout, max_stdout))));
    std::thread::spawn(move || sender.send(Pipe::Stderr(read_stderr(stderr))));

    let mut stdout = None;
    let mut stderr = Vec::new();
    let mut stderr_done = false;
    while stdout.is_none() || !stderr_done {
        match pipes.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(Pipe::Stdout(read)) => {
                let read = read.inspect_err(|_| kill(&mut child))?;
                let truncated = read.truncated;
                stdout = Some(read);
                // nobody reads the rest: the child stops here, and so does the wait for stderr
                if truncated {
                    kill(&mut child);
                    break;
                }
            }
            Ok(Pipe::Stderr(read)) => {
                stderr = read;
                stderr_done = true;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                kill(&mut child);
                return Err(TimedOut.into());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                kill(&mut child);
                anyhow::bail!("the output could not be read");
            }
        }
    }
    let stdout = stdout.context("the output was not read")?;
    let code = if stdout.truncated {
        -1
    } else {
        // both pipes closed: the child has ended, or is ending, so this wait is short
        child.wait()?.code().unwrap_or(-1)
    };
    Ok(Output {
        code,
        stdout: stdout.bytes,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        truncated: stdout.truncated,
    })
}

/// A pipe of the child, read to its end on a thread of its own.
enum Pipe {
    Stdout(std::io::Result<Stdout>),
    Stderr(Vec<u8>),
}

struct Stdout {
    bytes: Vec<u8>,
    /// There was more: the reading stopped at the limit.
    truncated: bool,
}

/// Reads at most `max` bytes, and one more to know whether there was more.
fn read_stdout(pipe: impl Read, max: usize) -> std::io::Result<Stdout> {
    let mut bytes = Vec::new();
    pipe.take((max as u64).saturating_add(1))
        .read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max;
    bytes.truncate(max);
    Ok(Stdout { bytes, truncated })
}

/// Keeps the start of stderr and drains the rest, so that the child never blocks writing to it.
fn read_stderr(mut pipe: impl Read) -> Vec<u8> {
    let mut bytes = Vec::new();
    let _ = (&mut pipe)
        .take(MAX_STDERR_BYTES as u64)
        .read_to_end(&mut bytes);
    let _ = std::io::copy(&mut pipe, &mut std::io::sink());
    bytes
}

fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn shell(script: &str) -> Command {
        let mut command = Command::new("sh");
        command
            .args(["-c", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    #[cfg(unix)]
    #[test]
    fn output_past_the_limit_is_cut_and_the_process_killed() {
        let started = Instant::now();
        // writes forever: only killing it ends the call
        let out = run(&mut shell("yes"), None, 1000, Duration::from_secs(10)).unwrap();
        assert!(out.truncated);
        assert_eq!(out.code, -1);
        assert_eq!(out.stdout, b"y\n".repeat(500));
        assert!(started.elapsed() < Duration::from_secs(5));

        let out = run(&mut shell("printf abc"), None, 3, Duration::from_secs(10)).unwrap();
        assert_eq!(
            (out.stdout.as_slice(), out.truncated, out.code),
            (&b"abc"[..], false, 0)
        );
    }

    #[cfg(unix)]
    #[test]
    fn input_is_written_and_stderr_kept() {
        let out = run(
            &mut shell("cat; echo oops >&2; exit 3"),
            Some(b"in"),
            1000,
            Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(out.stdout, b"in");
        assert_eq!(out.stderr, "oops\n");
        assert_eq!(out.code, 3);
    }
}
