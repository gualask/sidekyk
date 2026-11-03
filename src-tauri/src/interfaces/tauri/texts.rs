//! The text the backend writes for the user, in the UI's language (`Settings::language`): the
//! tray, the dialogs' titles, an export of notes, a project's first list. The frontend's own is in
//! `src/shared/i18n/messages`; both languages have every field, as the struct asks. Statics, so
//! that a language's texts live as long as the app.

use std::sync::atomic::{AtomicUsize, Ordering};

use sidekyk_core::modules::notes::ExportWords;
use sidekyk_core::modules::settings::Language;

pub(crate) struct Texts {
    pub(crate) show: &'static str,
    /// The tray's item that starts a capture, and the overlay's button that takes the area.
    pub(crate) capture: &'static str,
    pub(crate) quit: &'static str,
    /// The folder picker's title for a new project.
    pub(crate) choose_folder: &'static str,
    /// `{name}`: the folder's.
    pub(crate) locate: &'static str,
    /// The folder picker's title for another folder of a project; `{name}`: the project's.
    pub(crate) add_folder: &'static str,
    pub(crate) export_notes: &'static str,
    /// The file an export suggests; `{name}`: the project's.
    pub(crate) export_file: &'static str,
    pub(crate) export: ExportWords,
    pub(crate) first_list: &'static str,
}

static ENGLISH: Texts = Texts {
    show: "Show Sidekyk",
    capture: "Capture",
    quit: "Quit Sidekyk",
    choose_folder: "Choose the project's folder",
    locate: "Locate {name}",
    add_folder: "Add a folder to {name}",
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
    capture: "Cattura",
    quit: "Esci da Sidekyk",
    choose_folder: "Scegli la cartella del progetto",
    locate: "Individua {name}",
    add_folder: "Aggiungi una cartella a {name}",
    export_notes: "Esporta le note",
    export_file: "{name}-note.md",
    export: ExportWords {
        notes: "note",
        no_notes: "Nessuna nota.",
        done: "Completate",
    },
    first_list: "Generale",
};

/// The texts in effect, by `ALL`'s index: read apart from the settings' lock, which a change holds
/// while it waits on the main thread, where the tray and the global shortcuts read them.
static CURRENT: AtomicUsize = AtomicUsize::new(0);
static ALL: [&Texts; 2] = [&ENGLISH, &ITALIAN];

/// Puts a language's texts in effect; English until the frontend stores the system's language,
/// at the first start.
pub(crate) fn set(language: Option<Language>) -> &'static Texts {
    let index = match language {
        Some(Language::It) => 1,
        Some(Language::En) | None => 0,
    };
    CURRENT.store(index, Ordering::Relaxed);
    ALL[index]
}

/// The texts in effect.
pub(crate) fn current() -> &'static Texts {
    ALL[CURRENT.load(Ordering::Relaxed)]
}
