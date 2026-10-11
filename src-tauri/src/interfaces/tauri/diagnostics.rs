//! Errors the frontend reports, kept in the same log as the backend's.

/// Longer messages (a stack trace) are cut, so one report cannot flood the log.
const MAX_MESSAGE_CHARS: usize = 4_000;

fn bounded(message: &str) -> &str {
    message
        .char_indices()
        .nth(MAX_MESSAGE_CHARS)
        .map_or(message, |(end, _)| &message[..end])
}

#[tauri::command]
/// An uncaught error or rejected promise in the frontend.
pub(crate) fn log_frontend_error(message: String) {
    tracing::error!(message = bounded(&message), "frontend error");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_messages_are_cut_on_a_character_boundary() {
        assert_eq!(bounded("short"), "short");
        let long = "è".repeat(MAX_MESSAGE_CHARS + 10);
        assert_eq!(bounded(&long).chars().count(), MAX_MESSAGE_CHARS);
    }
}
