//! The global shortcut that shows and hides the window: which one is registered, and where it
//! stands. The system is reached through `ShortcutRegistrar`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use super::contracts::{GlobalShortcut, GlobalShortcutStatus};
use super::shortcut_keys::ShortcutKeys;
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::sync::lock;

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
    fn register(&self, keys: &ShortcutKeys) -> Result<(), RegisterError>;
    fn unregister(&self, keys: &ShortcutKeys);
    /// Whether the system keeps these keys for a shortcut of its own, which gets them first,
    /// while it registers ours without an error.
    fn system_uses(&self, keys: &ShortcutKeys) -> bool;
}

/// The global shortcut registered, and where it stands.
#[derive(Default)]
pub struct GlobalShortcuts {
    state: Mutex<State>,
    /// A new shortcut is being typed in the settings: pressing the current one does nothing.
    /// Apart from `state`, which a change holds while the main thread registers its shortcut: a
    /// press, handled on the main thread, must not wait for it.
    recording: AtomicBool,
}

#[derive(Default)]
struct State {
    /// The settings last applied, taken or not: applying them again changes nothing, so a
    /// shortcut refused at startup does not fail the change of another setting.
    applied: Option<GlobalShortcut>,
    registered: Option<ShortcutKeys>,
    status: GlobalShortcutStatus,
}

impl GlobalShortcuts {
    /// Registers the stored shortcut. One the system turns down leaves none, and its status says
    /// why, for the top bar's problems.
    pub fn start(&self, registrar: &impl ShortcutRegistrar, settings: &GlobalShortcut) {
        let mut state = lock(&self.state);
        if let Err(code) = switch(registrar, &mut state, settings) {
            tracing::warn!(keys = %settings.keys, code = code.as_str(), "no global shortcut");
            if code == UserFacingErrorCode::ShortcutTaken {
                state.status = GlobalShortcutStatus::Refused {
                    keys: settings.keys.clone(),
                };
            }
        }
        state.applied = Some(settings.clone());
    }

    /// The system offers no global shortcut: settings are only kept.
    pub fn unavailable(&self) {
        lock(&self.state).status = GlobalShortcutStatus::Unavailable;
    }

    /// Registers the shortcut of new settings in place of the current one, before they are
    /// stored. One the system turns down, or that is not a shortcut, leaves the current one, and
    /// fails.
    pub fn apply(
        &self,
        registrar: &impl ShortcutRegistrar,
        settings: &GlobalShortcut,
    ) -> anyhow::Result<()> {
        let mut state = lock(&self.state);
        if state.status == GlobalShortcutStatus::Unavailable
            || state.applied.as_ref() == Some(settings)
        {
            return Ok(());
        }
        switch(registrar, &mut state, settings).map_err(user_facing)?;
        state.applied = Some(settings.clone());
        Ok(())
    }

    pub fn status(&self) -> GlobalShortcutStatus {
        lock(&self.state).status.clone()
    }

    pub fn set_recording(&self, recording: bool) {
        self.recording.store(recording, Ordering::Relaxed);
    }

    /// Whether a press of the shortcut shows or hides the window: not while a new one is typed.
    pub fn takes_press(&self) -> bool {
        !self.recording.load(Ordering::Relaxed)
    }
}

/// Registers the new shortcut first, then lets the old one go, so a refusal keeps the old.
fn switch(
    registrar: &impl ShortcutRegistrar,
    state: &mut State,
    settings: &GlobalShortcut,
) -> Result<(), UserFacingErrorCode> {
    if !settings.enabled {
        if let Some(old) = state.registered.take() {
            registrar.unregister(&old);
        }
        state.status = GlobalShortcutStatus::Off;
        return Ok(());
    }
    let keys = ShortcutKeys::parse(&settings.keys).ok_or(UserFacingErrorCode::InvalidShortcut)?;
    if state.registered.as_ref() != Some(&keys) {
        registrar.register(&keys).map_err(|error| match error {
            RegisterError::Taken => UserFacingErrorCode::ShortcutTaken,
            RegisterError::Unsupported => UserFacingErrorCode::InvalidShortcut,
        })?;
        if let Some(old) = state.registered.replace(keys.clone()) {
            registrar.unregister(&old);
        }
    }
    state.status = GlobalShortcutStatus::Active {
        conflict: registrar.system_uses(&keys),
        keys: keys.as_str().to_string(),
    };
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
        registered: RefCell<Vec<String>>,
        taken: Vec<&'static str>,
        its_own: Vec<&'static str>,
    }

    impl ShortcutRegistrar for FakeSystem {
        fn register(&self, keys: &ShortcutKeys) -> Result<(), RegisterError> {
            if self.taken.contains(&keys.as_str()) {
                return Err(RegisterError::Taken);
            }
            self.registered.borrow_mut().push(keys.as_str().to_string());
            Ok(())
        }

        fn unregister(&self, keys: &ShortcutKeys) {
            self.registered.borrow_mut().retain(|k| k != keys.as_str());
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
    fn starts_with_the_stored_shortcut() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        assert_eq!(*system.registered.borrow(), ["Control+Alt+Space"]);
        assert_eq!(shortcuts.status(), active("Control+Alt+Space", false));
    }

    #[test]
    fn a_stored_shortcut_taken_at_startup_is_refused() {
        let system = FakeSystem {
            taken: vec!["Control+Alt+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        assert!(system.registered.borrow().is_empty());
        assert_eq!(
            shortcuts.status(),
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
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        // another setting changes: the shortcut's settings come back as they were
        assert!(shortcuts.apply(&system, &on("Control+Alt+Space")).is_ok());
        assert!(matches!(
            shortcuts.status(),
            GlobalShortcutStatus::Refused { .. }
        ));
    }

    #[test]
    fn a_new_shortcut_replaces_the_old_once_registered() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        shortcuts.apply(&system, &on("Super+F5")).unwrap();
        assert_eq!(*system.registered.borrow(), ["Super+F5"]);
        assert_eq!(shortcuts.status(), active("Super+F5", false));
    }

    #[test]
    fn a_shortcut_taken_keeps_the_current_one_and_fails() {
        let system = FakeSystem {
            taken: vec!["Shift+Super+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        let result = shortcuts.apply(&system, &on("Shift+Super+Space"));
        assert_eq!(code(result), Some(UserFacingErrorCode::ShortcutTaken));
        assert_eq!(*system.registered.borrow(), ["Control+Alt+Space"]);
        assert_eq!(shortcuts.status(), active("Control+Alt+Space", false));
    }

    #[test]
    fn keys_that_are_no_shortcut_fail_before_the_system_is_asked() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        let result = shortcuts.apply(&system, &on("Shift+KeyA"));
        assert_eq!(code(result), Some(UserFacingErrorCode::InvalidShortcut));
        assert_eq!(*system.registered.borrow(), ["Control+Alt+Space"]);
    }

    #[test]
    fn turned_off_it_lets_go_and_on_again_it_registers() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Control+Alt+Space"));
        shortcuts.apply(&system, &off("Control+Alt+Space")).unwrap();
        assert!(system.registered.borrow().is_empty());
        assert_eq!(shortcuts.status(), GlobalShortcutStatus::Off);
        shortcuts.apply(&system, &on("Control+Alt+Space")).unwrap();
        assert_eq!(*system.registered.borrow(), ["Control+Alt+Space"]);
    }

    #[test]
    fn a_shortcut_the_system_uses_too_is_active_with_a_conflict() {
        let system = FakeSystem {
            its_own: vec!["Super+Space"],
            ..FakeSystem::default()
        };
        let shortcuts = GlobalShortcuts::default();
        shortcuts.start(&system, &on("Super+Space"));
        assert_eq!(shortcuts.status(), active("Super+Space", true));
    }

    #[test]
    fn without_the_system_settings_are_only_kept() {
        let system = FakeSystem::default();
        let shortcuts = GlobalShortcuts::default();
        shortcuts.unavailable();
        assert!(shortcuts.apply(&system, &on("Control+Alt+Space")).is_ok());
        assert!(system.registered.borrow().is_empty());
        assert_eq!(shortcuts.status(), GlobalShortcutStatus::Unavailable);
    }

    #[test]
    fn presses_do_nothing_while_a_new_shortcut_is_typed() {
        let shortcuts = GlobalShortcuts::default();
        assert!(shortcuts.takes_press());
        shortcuts.set_recording(true);
        assert!(!shortcuts.takes_press());
        shortcuts.set_recording(false);
        assert!(shortcuts.takes_press());
    }
}
