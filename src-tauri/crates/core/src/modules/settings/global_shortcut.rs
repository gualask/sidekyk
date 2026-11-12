//! The global shortcuts: the one that shows and hides the window and, where they are built, the
//! one that captures an area of the screen and the one that opens a quick note; which keys each
//! registered, and where each stands. The system is reached through `ShortcutRegistrar`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use super::contracts::{GlobalShortcut, GlobalShortcutStatus, GlobalShortcutStatuses, Settings};
use super::shortcut_keys::ShortcutKeys;
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

/// What a global shortcut does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShortcutAction {
    /// Shows or hides the window.
    Toggle,
    /// Captures an area of the screen.
    Capture,
    /// Opens a quick note for the Inbox.
    Note,
}

/// Why the system did not register a shortcut.
#[derive(Debug, PartialEq, Eq)]
pub enum RegisterError {
    /// Another app or the system holds it.
    Taken,
    /// The system has no name for these keys.
    Unsupported,
}

/// The system's global shortcuts.
pub trait ShortcutRegistrar {
    fn register(&self, action: ShortcutAction, keys: &ShortcutKeys) -> Result<(), RegisterError>;
    fn unregister(&self, action: ShortcutAction, keys: &ShortcutKeys);
    /// Whether the system keeps these keys for a shortcut of its own, which gets them first,
    /// while it registers ours without an error.
    fn system_uses(&self, keys: &ShortcutKeys) -> bool;
}

/// The global shortcuts registered, and where each stands.
pub struct GlobalShortcuts {
    state: Mutex<Shortcuts>,
    /// A new shortcut is being typed in the settings: pressing one does nothing. Apart from
    /// `state`, which a change holds while the main thread registers its shortcut: a press,
    /// handled on the main thread, must not wait for it.
    recording: AtomicBool,
}

/// The shortcuts built here, the window's first, each with where it stands.
struct Shortcuts(Vec<(ShortcutAction, State)>);

#[derive(Default)]
struct State {
    /// The settings last applied, taken or not: applying them again changes nothing, so a
    /// shortcut refused at startup does not fail the change of another setting.
    applied: Option<GlobalShortcut>,
    registered: Option<ShortcutKeys>,
    status: GlobalShortcutStatus,
}

impl State {
    /// Its status once the system turned its `keys` down, for the top bar's problems.
    fn refused(&mut self, code: UserFacingErrorCode, keys: String) {
        match code {
            UserFacingErrorCode::ShortcutTaken => {
                self.status = GlobalShortcutStatus::Refused { keys };
            }
            UserFacingErrorCode::ShortcutInUse => {
                self.status = GlobalShortcutStatus::InUse { keys };
            }
            _ => {}
        }
    }
}

impl Shortcuts {
    /// The shortcut doing this, if built, and the keys the others registered, which it may not
    /// take.
    fn split(&mut self, action: ShortcutAction) -> Option<(&mut State, Vec<ShortcutKeys>)> {
        let others = self
            .0
            .iter()
            .filter(|(other, _)| *other != action)
            .filter_map(|(_, state)| state.registered.clone())
            .collect();
        let state = self
            .0
            .iter_mut()
            .find(|(each, _)| *each == action)
            .map(|(_, state)| state)?;
        Some((state, others))
    }

    fn status(&self, action: ShortcutAction) -> Option<GlobalShortcutStatus> {
        self.0
            .iter()
            .find(|(each, _)| *each == action)
            .map(|(_, state)| state.status.clone())
    }
}

/// Each shortcut and its settings, the window's first.
fn each(settings: &Settings) -> [(ShortcutAction, &GlobalShortcut); 3] {
    [
        (ShortcutAction::Toggle, &settings.global_shortcut),
        (ShortcutAction::Capture, &settings.capture_shortcut),
        (ShortcutAction::Note, &settings.note_shortcut),
    ]
}

impl GlobalShortcuts {
    /// `built`: the shortcuts beside the window's whose action is built here, and so offered.
    pub fn new(built: &[ShortcutAction]) -> Self {
        let mut shortcuts = vec![(ShortcutAction::Toggle, State::default())];
        shortcuts.extend(
            built
                .iter()
                .filter(|action| **action != ShortcutAction::Toggle)
                .map(|action| (*action, State::default())),
        );
        Self {
            state: Mutex::new(Shortcuts(shortcuts)),
            recording: AtomicBool::new(false),
        }
    }

    /// Registers the stored shortcuts. One the system turns down, or with another's keys, is
    /// left out, and its status says why, for the top bar's problems.
    pub fn start(&self, registrar: &impl ShortcutRegistrar, settings: &Settings) {
        let mut shortcuts = lock(&self.state);
        for (action, settings) in each(settings) {
            let Some((state, others)) = shortcuts.split(action) else {
                continue;
            };
            if let Err(code) = switch(registrar, action, state, &others, settings) {
                tracing::warn!(keys = %settings.keys, code = code.as_str(), "no global shortcut");
                state.refused(code, settings.keys.clone());
            }
            state.applied = Some(settings.clone());
        }
    }

    /// The system offers no global shortcut: settings are only kept.
    pub fn unavailable(&self) {
        for (_, state) in &mut lock(&self.state).0 {
            state.status = GlobalShortcutStatus::Unavailable;
        }
    }

    /// Registers the shortcuts of new settings in place of the current ones, before they are
    /// stored. One the system turns down, that is not a shortcut, or that has another's keys
    /// (as registered: a swap in one change is refused) fails, and leaves all as they were.
    pub fn apply(
        &self,
        registrar: &impl ShortcutRegistrar,
        settings: &Settings,
    ) -> anyhow::Result<()> {
        let mut shortcuts = lock(&self.state);
        if shortcuts.status(ShortcutAction::Toggle) == Some(GlobalShortcutStatus::Unavailable) {
            return Ok(());
        }
        // the shortcuts switched by this change, and their settings before it
        let mut switched = Vec::new();
        for (action, settings) in each(settings) {
            let Some((state, others)) = shortcuts.split(action) else {
                continue;
            };
            if state.applied.as_ref() == Some(settings) {
                continue;
            }
            if let Err(code) = switch(registrar, action, state, &others, settings) {
                restore(registrar, &mut shortcuts, switched);
                return Err(user_facing(code));
            }
            switched.push((action, state.applied.replace(settings.clone())));
        }
        Ok(())
    }

    pub fn status(&self) -> GlobalShortcutStatuses {
        let shortcuts = lock(&self.state);
        GlobalShortcutStatuses {
            toggle: shortcuts.status(ShortcutAction::Toggle).unwrap_or_default(),
            capture: shortcuts.status(ShortcutAction::Capture),
            note: shortcuts.status(ShortcutAction::Note),
        }
    }

    pub fn set_recording(&self, recording: bool) {
        self.recording.store(recording, Ordering::Relaxed);
    }

    /// Whether a press of a shortcut does what it does: not while a new one is typed.
    pub fn takes_press(&self) -> bool {
        !self.recording.load(Ordering::Relaxed)
    }
}

/// Puts the shortcuts a change switched back as they were, the change having failed further on.
fn restore(
    registrar: &impl ShortcutRegistrar,
    shortcuts: &mut Shortcuts,
    switched: Vec<(ShortcutAction, Option<GlobalShortcut>)>,
) {
    for (action, before) in switched {
        let (Some((state, others)), Some(before)) = (shortcuts.split(action), before) else {
            continue;
        };
        if let Err(code) = switch(registrar, action, state, &others, &before) {
            tracing::warn!(
                code = code.as_str(),
                "a global shortcut could not be put back"
            );
        }
        state.applied = Some(before);
    }
}

/// Registers the new shortcut first, then lets the old one go, so a refusal keeps the old.
fn switch(
    registrar: &impl ShortcutRegistrar,
    action: ShortcutAction,
    state: &mut State,
    others: &[ShortcutKeys],
    settings: &GlobalShortcut,
) -> Result<(), UserFacingErrorCode> {
    if !settings.enabled {
        if let Some(old) = state.registered.take() {
            registrar.unregister(action, &old);
        }
        state.status = GlobalShortcutStatus::Off;
        return Ok(());
    }
    let keys = ShortcutKeys::parse(&settings.keys).ok_or(UserFacingErrorCode::InvalidShortcut)?;
    if others.contains(&keys) {
        return Err(UserFacingErrorCode::ShortcutInUse);
    }
    register_in_place(registrar, action, state, &keys)?;
    state.status = GlobalShortcutStatus::Active {
        conflict: registrar.system_uses(&keys),
        keys: keys.as_str().to_string(),
    };
    Ok(())
}

/// Registers `keys` in place of the keys registered for `action`, unless they are those: the new
/// first, then the old let go.
fn register_in_place(
    registrar: &impl ShortcutRegistrar,
    action: ShortcutAction,
    state: &mut State,
    keys: &ShortcutKeys,
) -> Result<(), UserFacingErrorCode> {
    if state.registered.as_ref() == Some(keys) {
        return Ok(());
    }
    registrar
        .register(action, keys)
        .map_err(|error| match error {
            RegisterError::Taken => UserFacingErrorCode::ShortcutTaken,
            RegisterError::Unsupported => UserFacingErrorCode::InvalidShortcut,
        })?;
    if let Some(old) = state.registered.replace(keys.clone()) {
        registrar.unregister(action, &old);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::shared::error::user_facing_code;

    /// The system: what it registered, in order, and the keys other apps or itself hold.
    #[derive(Default)]
    struct FakeSystem {
        registered: RefCell<Vec<(ShortcutAction, String)>>,
        taken: Vec<&'static str>,
        its_own: Vec<&'static str>,
    }

    impl FakeSystem {
        fn keys(&self) -> Vec<String> {
            self.registered
                .borrow()
                .iter()
                .map(|(_, k)| k.clone())
                .collect()
        }
    }

    impl ShortcutRegistrar for FakeSystem {
        fn register(
            &self,
            action: ShortcutAction,
            keys: &ShortcutKeys,
        ) -> Result<(), RegisterError> {
            if self.taken.contains(&keys.as_str()) {
                return Err(RegisterError::Taken);
            }
            self.registered
                .borrow_mut()
                .push((action, keys.as_str().to_string()));
            Ok(())
        }

        fn unregister(&self, action: ShortcutAction, keys: &ShortcutKeys) {
            self.registered
                .borrow_mut()
                .retain(|(a, k)| (*a, k.as_str()) != (action, keys.as_str()));
        }

        fn system_uses(&self, keys: &ShortcutKeys) -> bool {
            self.its_own.contains(&keys.as_str())
        }
    }

    fn on(keys: &str) -> GlobalShortcut {
        GlobalShortcut {
            enabled: true,
            keys: keys.to_string(),
        }
    }

    fn off(keys: &str) -> GlobalShortcut {
        GlobalShortcut {
            enabled: false,
            keys: keys.to_string(),
        }
    }

    /// Settings with this shortcut to show the window, and the others off.
    fn toggle(shortcut: GlobalShortcut) -> Settings {
        both(shortcut, off("Control+Alt+KeyC"))
    }

    /// Settings with these shortcuts to show the window and to capture, and the note's off.
    fn both(toggle: GlobalShortcut, capture: GlobalShortcut) -> Settings {
        all(toggle, capture, off("Control+Alt+KeyN"))
    }

    fn all(toggle: GlobalShortcut, capture: GlobalShortcut, note: GlobalShortcut) -> Settings {
        Settings {
            global_shortcut: toggle,
            capture_shortcut: capture,
            note_shortcut: note,
            ..Settings::default()
        }
    }

    /// Every shortcut built.
    const ALL: [ShortcutAction; 2] = [ShortcutAction::Capture, ShortcutAction::Note];

    fn active(keys: &str, conflict: bool) -> GlobalShortcutStatus {
        GlobalShortcutStatus::Active {
            keys: keys.to_string(),
            conflict,
        }
    }

    fn code(result: anyhow::Result<()>) -> Option<UserFacingErrorCode> {
        user_facing_code(&result.unwrap_err())
    }

    #[test]
    fn starts_with_the_stored_shortcuts() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(
            &system,
            &both(on("Control+Alt+Space"), on("Control+Alt+KeyC")),
        );
        assert_eq!(
            *system.registered.borrow(),
            [
                (ShortcutAction::Toggle, "Control+Alt+Space".to_string()),
                (ShortcutAction::Capture, "Control+Alt+KeyC".to_string()),
            ]
        );
        assert_eq!(
            shortcuts.status(),
            GlobalShortcutStatuses {
                toggle: active("Control+Alt+Space", false),
                capture: Some(active("Control+Alt+KeyC", false)),
                note: Some(GlobalShortcutStatus::Off),
            }
        );
    }

    #[test]
    fn only_the_shortcuts_built_are_registered() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&[ShortcutAction::Note]);
        shortcuts.start(
            &system,
            &all(
                on("Control+Alt+Space"),
                on("Control+Alt+KeyC"),
                on("Control+Alt+KeyN"),
            ),
        );
        assert_eq!(system.keys(), ["Control+Alt+Space", "Control+Alt+KeyN"]);
        assert_eq!(shortcuts.status().capture, None);
        assert_eq!(
            shortcuts.status().note,
            Some(active("Control+Alt+KeyN", false))
        );
        let none = GlobalShortcuts::new(&[]);
        assert_eq!(none.status().note, None);
    }

    #[test]
    fn a_stored_shortcut_taken_at_startup_is_refused() {
        let system = FakeSystem {
            taken: vec!["Control+Alt+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(
            &system,
            &both(on("Control+Alt+Space"), on("Control+Alt+KeyC")),
        );
        assert_eq!(system.keys(), ["Control+Alt+KeyC"]);
        assert_eq!(
            shortcuts.status().toggle,
            GlobalShortcutStatus::Refused {
                keys: "Control+Alt+Space".to_string()
            }
        );
    }

    #[test]
    fn the_same_settings_again_change_nothing_even_when_refused() {
        let system = FakeSystem {
            taken: vec!["Control+Alt+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(&system, &toggle(on("Control+Alt+Space")));
        // another setting changes: the shortcuts' settings come back as they were
        assert!(shortcuts
            .apply(&system, &toggle(on("Control+Alt+Space")))
            .is_ok());
        assert!(matches!(
            shortcuts.status().toggle,
            GlobalShortcutStatus::Refused { .. }
        ));
    }

    #[test]
    fn a_new_shortcut_replaces_the_old_once_registered() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(
            &system,
            &both(on("Control+Alt+Space"), on("Control+Alt+KeyC")),
        );
        shortcuts
            .apply(&system, &both(on("Control+Alt+Space"), on("Super+F5")))
            .unwrap();
        assert_eq!(system.keys(), ["Control+Alt+Space", "Super+F5"]);
        assert_eq!(shortcuts.status().capture, Some(active("Super+F5", false)));
    }

    #[test]
    fn a_shortcut_taken_keeps_the_current_one_and_fails() {
        let system = FakeSystem {
            taken: vec!["Shift+Super+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(&system, &toggle(on("Control+Alt+Space")));
        let result = shortcuts.apply(&system, &toggle(on("Shift+Super+Space")));
        assert_eq!(code(result), Some(UserFacingErrorCode::ShortcutTaken));
        assert_eq!(system.keys(), ["Control+Alt+Space"]);
        assert_eq!(
            shortcuts.status().toggle,
            active("Control+Alt+Space", false)
        );
    }

    #[test]
    fn the_other_shortcuts_keys_keep_the_current_one_and_fail() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(
            &system,
            &both(on("Control+Alt+Space"), on("Control+Alt+KeyC")),
        );
        let result = shortcuts.apply(
            &system,
            &both(on("Control+Alt+Space"), on("Control+Alt+Space")),
        );
        assert_eq!(code(result), Some(UserFacingErrorCode::ShortcutInUse));
        assert_eq!(system.keys(), ["Control+Alt+Space", "Control+Alt+KeyC"]);
        // the window's turned off frees its keys for capture
        shortcuts
            .apply(
                &system,
                &both(off("Control+Alt+Space"), on("Control+Alt+Space")),
            )
            .unwrap();
        assert_eq!(
            *system.registered.borrow(),
            [(ShortcutAction::Capture, "Control+Alt+Space".to_string())]
        );
        let result = shortcuts.apply(
            &system,
            &both(on("Control+Alt+Space"), on("Control+Alt+Space")),
        );
        assert_eq!(code(result), Some(UserFacingErrorCode::ShortcutInUse));
    }

    #[test]
    fn no_shortcut_takes_the_keys_of_any_other() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        let before = all(
            on("Control+Alt+Space"),
            on("Control+Alt+KeyC"),
            on("Control+Alt+KeyN"),
        );
        shortcuts.start(&system, &before);
        for taken in ["Control+Alt+Space", "Control+Alt+KeyC"] {
            let result = shortcuts.apply(
                &system,
                &all(on("Control+Alt+Space"), on("Control+Alt+KeyC"), on(taken)),
            );
            assert_eq!(code(result), Some(UserFacingErrorCode::ShortcutInUse));
        }
        assert_eq!(
            system.keys(),
            ["Control+Alt+Space", "Control+Alt+KeyC", "Control+Alt+KeyN"]
        );
        assert_eq!(
            shortcuts.status().note,
            Some(active("Control+Alt+KeyN", false))
        );
    }

    #[test]
    fn the_others_keys_at_startup_leave_it_in_use() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(
            &system,
            &both(on("Control+Alt+KeyC"), on("Control+Alt+KeyC")),
        );
        assert_eq!(system.keys(), ["Control+Alt+KeyC"]);
        assert_eq!(
            shortcuts.status().capture,
            Some(GlobalShortcutStatus::InUse {
                keys: "Control+Alt+KeyC".to_string()
            })
        );
    }

    #[test]
    fn a_change_failing_on_one_shortcut_puts_the_other_back() {
        let system = FakeSystem {
            taken: vec!["Super+F6"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::new(&ALL);
        let before = both(on("Control+Alt+Space"), on("Control+Alt+KeyC"));
        shortcuts.start(&system, &before);
        let result = shortcuts.apply(&system, &both(on("Super+F5"), on("Super+F6")));
        assert_eq!(code(result), Some(UserFacingErrorCode::ShortcutTaken));
        assert_eq!(system.keys(), ["Control+Alt+KeyC", "Control+Alt+Space"]);
        assert_eq!(
            shortcuts.status().toggle,
            active("Control+Alt+Space", false)
        );
        // the settings as stored apply as nothing new
        assert!(shortcuts.apply(&system, &before).is_ok());
        assert_eq!(system.keys(), ["Control+Alt+KeyC", "Control+Alt+Space"]);
    }

    #[test]
    fn keys_that_are_no_shortcut_fail_before_the_system_is_asked() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(&system, &toggle(on("Control+Alt+Space")));
        let result = shortcuts.apply(&system, &toggle(on("Shift+KeyA")));
        assert_eq!(code(result), Some(UserFacingErrorCode::InvalidShortcut));
        assert_eq!(system.keys(), ["Control+Alt+Space"]);
    }

    #[test]
    fn turned_off_it_lets_go_and_on_again_it_registers() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(&system, &toggle(on("Control+Alt+Space")));
        shortcuts
            .apply(&system, &toggle(off("Control+Alt+Space")))
            .unwrap();
        assert!(system.registered.borrow().is_empty());
        assert_eq!(shortcuts.status().toggle, GlobalShortcutStatus::Off);
        shortcuts
            .apply(&system, &toggle(on("Control+Alt+Space")))
            .unwrap();
        assert_eq!(system.keys(), ["Control+Alt+Space"]);
    }

    #[test]
    fn a_shortcut_the_system_uses_too_is_active_with_a_conflict() {
        let system = FakeSystem {
            its_own: vec!["Super+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.start(&system, &toggle(on("Super+Space")));
        assert_eq!(shortcuts.status().toggle, active("Super+Space", true));
    }

    #[test]
    fn without_the_system_settings_are_only_kept() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::new(&ALL);
        shortcuts.unavailable();
        assert!(shortcuts
            .apply(
                &system,
                &both(on("Control+Alt+Space"), on("Control+Alt+KeyC"))
            )
            .is_ok());
        assert!(system.registered.borrow().is_empty());
        assert_eq!(
            shortcuts.status(),
            GlobalShortcutStatuses {
                toggle: GlobalShortcutStatus::Unavailable,
                capture: Some(GlobalShortcutStatus::Unavailable),
                note: Some(GlobalShortcutStatus::Unavailable),
            }
        );
    }

    #[test]
    fn presses_do_nothing_while_a_new_shortcut_is_typed() {
        let shortcuts = GlobalShortcuts::new(&ALL);
        assert!(shortcuts.takes_press());
        shortcuts.set_recording(true);
        assert!(!shortcuts.takes_press());
        shortcuts.set_recording(false);
        assert!(shortcuts.takes_press());
    }
}
