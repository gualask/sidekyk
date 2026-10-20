//! The text the backend writes for the user, in the UI's language (`Settings::language`): the
//! tray, the dialogs' titles, an export of notes, a project's first list. The frontend's own is in
//! `src/shared/i18n/messages`; both languages have every field, as the struct asks. Statics, so
//! that one language is one address (`tray::speak` compares them).

use sidekyk_core::modules::notes::ExportWords;
use sidekyk_core::modules::settings::Language;

use crate::infrastructure::settings_store;

pub(crate) struct Texts {
    pub(crate) show: &'static str,
    pub(crate) quit: &'static str,
    /// The tray's tooltip, after the project's name.
    pub(crate) no_changes: &'static str,
    pub(crate) one_changed_file: &'static str,
    /// `{count}`: how many, `12` or `10000+`.
    pub(crate) changed_files: &'static str,
    pub(crate) add_repository: &'static str,
    /// `{name}`: the project's.
    pub(crate) locate: &'static str,
    pub(crate) export_notes: &'static str,
    /// The file an export suggests; `{name}`: the project's.
    pub(crate) export_file: &'static str,
    pub(crate) export: ExportWords,
    pub(crate) first_list: &'static str,
}

static ENGLISH: Texts = Texts {
    show: "Show Sidekyk",
    quit: "Quit Sidekyk",
    no_changes: "no changes",
    one_changed_file: "1 changed file",
    changed_files: "{count} changed files",
    add_repository: "Add a repository",
    locate: "Locate {name}",
    export_notes: "Export notes",
    export_file: "{name}-notes.md",
    export: ExportWords {
        notes: "notes",
        no_notes: "No notes.",
        done: "Done",
    },
    first_list: "General",
};

static ITALIAN: Texts = Texts {
    show: "Mostra Sidekyk",
    quit: "Esci da Sidekyk",
    no_changes: "nessuna modifica",
    one_changed_file: "1 file modificato",
    changed_files: "{count} file modificati",
    add_repository: "Aggiungi un repository",
    locate: "Individua {name}",
    export_notes: "Esporta le note",
    export_file: "{name}-note.md",
    export: ExportWords {
        notes: "note",
        no_notes: "Nessuna nota.",
        done: "Completate",
    },
    first_list: "Generale",
};

/// English until the frontend stores the system's language, at the first start.
pub(crate) fn texts(language: Option<Language>) -> &'static Texts {
    match language {
        Some(Language::It) => &ITALIAN,
        Some(Language::En) | None => &ENGLISH,
    }
}

/// In the language of the stored settings.
pub(crate) fn current(app: &tauri::AppHandle) -> &'static Texts {
    texts(settings_store::load_settings(app).language)
}
