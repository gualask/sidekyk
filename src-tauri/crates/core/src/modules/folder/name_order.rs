//! The order of names in a folder, as the Files panel lists them.

use std::cmp::Ordering;
use std::ops::ControlFlow;

/// The order of names in a folder, as VS Code's explorer: letters ignoring case, numbers by
/// value ("file2" before "file10"), then the exact text, so the order is total.
pub fn compare_names(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a, b);
    loop {
        match compare_first(x, y) {
            ControlFlow::Continue(rest) => (x, y) = rest,
            // both ended, the same but for case or zeros: the exact text decides
            ControlFlow::Break(Ordering::Equal) => return a.cmp(b),
            ControlFlow::Break(order) => return order,
        }
    }
}

/// The order of the first letter, or number, of what is left of two names, equal when both
/// ended; what follows each when those are the same.
fn compare_first<'a, 'b>(x: &'a str, y: &'b str) -> ControlFlow<Ordering, (&'a str, &'b str)> {
    let (cx, cy) = match (x.chars().next(), y.chars().next()) {
        (None, None) => return ControlFlow::Break(Ordering::Equal),
        (None, Some(_)) => return ControlFlow::Break(Ordering::Less),
        (Some(_), None) => return ControlFlow::Break(Ordering::Greater),
        (Some(cx), Some(cy)) => (cx, cy),
    };
    if cx.is_ascii_digit() && cy.is_ascii_digit() {
        let (nx, rest_x) = split_digits(x);
        let (ny, rest_y) = split_digits(y);
        let (vx, vy) = (nx.trim_start_matches('0'), ny.trim_start_matches('0'));
        let by_value = vx.len().cmp(&vy.len()).then_with(|| vx.cmp(vy));
        if by_value.is_ne() {
            return ControlFlow::Break(by_value);
        }
        return ControlFlow::Continue((rest_x, rest_y));
    }
    let by_letter = cx.to_lowercase().cmp(cy.to_lowercase());
    if by_letter.is_ne() {
        return ControlFlow::Break(by_letter);
    }
    ControlFlow::Continue((&x[cx.len_utf8()..], &y[cy.len_utf8()..]))
}

fn split_digits(text: &str) -> (&str, &str) {
    let end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    text.split_at(end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_sort_ignoring_case_and_numbers_by_value() {
        let mut names = vec!["b.ts", "file10", "A.ts", "file2", "a.ts", "file02", "_x"];
        names.sort_by(|a, b| compare_names(a, b));
        assert_eq!(
            names,
            ["_x", "A.ts", "a.ts", "b.ts", "file02", "file2", "file10"]
        );
    }
}
