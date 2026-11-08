//! Values stored as JSON that another version may have written, older or newer: read for what
//! reads, written back with only what changed. A value this version cannot read, or does not
//! know, stays stored as it is until the user changes it here.

use std::collections::{HashMap, HashSet};

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{Map, Value};

/// `stored` as a `T`, each value that reads taken: one that does not (a typo, a value of another
/// version) takes its default, and inside an object the values beside it still read.
pub(crate) fn read_lenient<T: Serialize + DeserializeOwned + Default>(stored: &Value) -> T {
    if let Ok(read) = T::deserialize(stored) {
        return read;
    }
    let (Ok(mut read), Some(stored)) = (serde_json::to_value(T::default()), stored.as_object())
    else {
        tracing::warn!("stored values do not read: the defaults in use, the stored ones kept");
        return T::default();
    };
    take_what_reads(&mut read, &mut Vec::new(), stored, &|read| {
        T::deserialize(read).is_ok()
    });
    T::deserialize(&read).unwrap_or_default()
}

/// Puts each value of `stored` at `path` in `read`, kept only where `read` still reads: an
/// object that does not is taken value by value.
fn take_what_reads(
    read: &mut Value,
    path: &mut Vec<String>,
    stored: &Map<String, Value>,
    reads: &dyn Fn(&Value) -> bool,
) {
    for (key, value) in stored {
        let before = object_at(read, path).insert(key.clone(), value.clone());
        if reads(read) {
            continue;
        }
        match (before, value) {
            (Some(Value::Object(before)), Value::Object(inner)) => {
                object_at(read, path).insert(key.clone(), Value::Object(before));
                path.push(key.clone());
                take_what_reads(read, path, inner, reads);
                path.pop();
            }
            (before, _) => {
                tracing::warn!(
                    value = %path.iter().chain([key]).cloned().collect::<Vec<_>>().join("."),
                    "a stored value does not read: its default in use, the stored one kept"
                );
                let at = object_at(read, path);
                match before {
                    Some(before) => at.insert(key.clone(), before),
                    None => at.remove(key),
                };
            }
        }
    }
}

/// The object at `path` in `value`: `take_what_reads` goes only into objects.
fn object_at<'a>(value: &'a mut Value, path: &[String]) -> &'a mut Map<String, Value> {
    path.iter()
        .fold(value, |at, key| &mut at[key.as_str()])
        .as_object_mut()
        .expect("a path through objects")
}

/// What to store: `stored` with the changes from `read` (what this version read of it) to
/// `written`. A value changed is written, one taken out removed; every other value stays as
/// stored, even one that did not read or that this version does not know. Objects change value by
/// value; lists of objects with an `id` (projects, folders) element by element, an element
/// stored that this version did not read staying at its place; any other value whole.
pub(crate) fn with_changes(stored: Option<Value>, read: Option<&Value>, written: &Value) -> Value {
    match (stored, written) {
        (Some(stored), _) if read == Some(written) => stored,
        (Some(Value::Object(stored)), Value::Object(written)) => Value::Object(
            object_with_changes(stored, read.and_then(Value::as_object), written),
        ),
        (Some(Value::Array(stored)), Value::Array(written)) => {
            let read = read.map_or(Some(&[][..]), |read| read.as_array().map(Vec::as_slice));
            match read.filter(|read| listed_by_id(written, read)) {
                Some(read) => Value::Array(list_with_changes(stored, read, written)),
                None => Value::Array(written.clone()),
            }
        }
        _ => written.clone(),
    }
}

fn object_with_changes(
    mut stored: Map<String, Value>,
    read: Option<&Map<String, Value>>,
    written: &Map<String, Value>,
) -> Map<String, Value> {
    for (key, value) in written {
        let before = read.and_then(|read| read.get(key));
        if before != Some(value) {
            let kept = stored.remove(key);
            stored.insert(key.clone(), with_changes(kept, before, value));
        }
    }
    for key in read.into_iter().flat_map(Map::keys) {
        if !written.contains_key(key) {
            stored.remove(key);
        }
    }
    stored
}

fn id_of(value: &Value) -> Option<&str> {
    value.get("id")?.as_str()
}

/// Whether every element of both lists is an object with an id.
fn listed_by_id(written: &[Value], read: &[Value]) -> bool {
    written.iter().chain(read).all(|v| id_of(v).is_some())
}

/// `with_changes` for lists `listed_by_id`.
fn list_with_changes(stored: Vec<Value>, read: &[Value], written: &[Value]) -> Vec<Value> {
    let known: HashSet<&str> = read.iter().chain(written).filter_map(id_of).collect();
    let mut stored_known = HashMap::new();
    let mut unread = Vec::new();
    for (index, value) in stored.into_iter().enumerate() {
        match id_of(&value)
            .filter(|id| known.contains(id))
            .map(str::to_owned)
        {
            // a second element with an id read is one this version kept once
            Some(id) => {
                stored_known.entry(id).or_insert(value);
            }
            None => unread.push((index, value)),
        }
    }
    let mut list: Vec<Value> = written
        .iter()
        .filter_map(|value| {
            let id = id_of(value)?;
            let before = read.iter().find(|r| id_of(r) == Some(id));
            Some(with_changes(stored_known.remove(id), before, value))
        })
        .collect();
    for (index, value) in unread {
        list.insert(index.min(list.len()), value);
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    #[serde(default)]
    struct Shape {
        theme: Theme,
        size: u32,
        inner: Inner,
    }

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    #[serde(default)]
    struct Inner {
        on: bool,
        keys: String,
    }

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    enum Theme {
        #[default]
        Dark,
        Light,
    }

    #[test]
    fn each_value_that_reads_is_taken_one_that_does_not_takes_its_default() {
        let stored = json!({
            "theme": "purple",
            "size": 12,
            "inner": { "on": true, "keys": 5 },
            "unknown": 1
        });
        assert_eq!(
            read_lenient::<Shape>(&stored),
            Shape {
                theme: Theme::Dark,
                size: 12,
                inner: Inner {
                    on: true,
                    keys: String::new(),
                },
            }
        );
        assert_eq!(
            read_lenient::<Shape>(&json!("not an object")),
            Shape::default()
        );
    }

    #[test]
    fn only_what_changed_is_written() {
        let stored = json!({ "theme": "purple", "size": 12, "inner": { "on": true, "keys": 5 }, "unknown": 1 });
        let read = serde_json::to_value(read_lenient::<Shape>(&stored)).unwrap();
        // nothing changed: stored as it is
        assert_eq!(
            with_changes(Some(stored.clone()), Some(&read), &read),
            stored
        );
        let mut written = read.clone();
        written["inner"]["on"] = false.into();
        assert_eq!(
            with_changes(Some(stored.clone()), Some(&read), &written),
            json!({ "theme": "purple", "size": 12, "inner": { "on": false, "keys": 5 }, "unknown": 1 })
        );
        written["theme"] = "light".into();
        assert_eq!(
            with_changes(Some(stored), Some(&read), &written)["theme"],
            "light"
        );
        // nothing stored, or nothing read: what is written
        assert_eq!(with_changes(None, None, &written), written);
    }

    #[test]
    fn a_map_s_entries_removed_are_removed_the_others_stay() {
        let stored = json!({ "a": 1, "b": "x", "c": 3 });
        let read = json!({ "a": 1, "c": 3 });
        assert_eq!(
            with_changes(Some(stored), Some(&read), &json!({ "a": 2, "d": 4 })),
            json!({ "a": 2, "b": "x", "d": 4 })
        );
    }

    #[test]
    fn a_list_by_id_keeps_the_elements_not_read_at_their_place() {
        let stored = json!([
            { "id": "a", "name": "shop", "color": "red" },
            { "id": "z", "kind": "of a newer version" },
            { "id": "b", "name": "docs" },
            { "id": "b", "name": "docs again" },
            { "id": "c", "name": "gone" }
        ]);
        let read = json!([
            { "id": "a", "name": "shop" },
            { "id": "b", "name": "docs" },
            { "id": "c", "name": "gone" }
        ]);
        let written = json!([
            { "id": "a", "name": "store" },
            { "id": "b", "name": "docs" },
            { "id": "d", "name": "new" }
        ]);
        assert_eq!(
            with_changes(Some(stored), Some(&read), &written),
            json!([
                { "id": "a", "name": "store", "color": "red" },
                { "id": "z", "kind": "of a newer version" },
                { "id": "b", "name": "docs" },
                { "id": "d", "name": "new" }
            ])
        );
        // a list of plain values changes whole
        assert_eq!(
            with_changes(Some(json!(["a", "b"])), Some(&json!(["a"])), &json!(["c"])),
            json!(["c"])
        );
    }
}
