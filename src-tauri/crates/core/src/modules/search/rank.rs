//! Ranking, by `nucleo-matcher`: fzf's scoring, which favours letters that follow each other and
//! the starts of words (and, for paths, of file and folder names). Names and paths match fuzzily;
//! prose by the words typed, as letters scattered over a sentence would match almost any.

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use std::cmp::Reverse;

use super::contracts::Highlight;
use crate::shared::threads::threads;

/// From this many texts, scoring is split over threads: a large repository's every file is scored
/// at each key typed (200,000 paths: ~80 ms on one thread).
const PARALLEL_FROM: usize = 20_000;

/// What the texts ranked are: names, paths with `/` between their parts, or prose (notes).
#[derive(Clone, Copy)]
pub enum Texts {
    Names,
    Paths,
    Prose,
}

/// A text that matched: its position among those ranked, and how well it matched (comparable
/// across the texts a query ranks).
#[derive(Debug, PartialEq, Eq)]
pub struct Scored {
    pub index: usize,
    pub score: u32,
}

/// A text that matched, and where the query's letters are in it.
#[derive(Debug, PartialEq, Eq)]
pub struct Ranked {
    pub index: usize,
    pub score: u32,
    pub highlights: Vec<Highlight>,
}

/// A query typed in the palette. Each of its words must match, in any order: in names and paths a
/// word's letters in order, not necessarily together; in prose the word itself. Case is ignored,
/// and a plain letter matches its accented forms.
pub struct Ranker {
    pattern: Pattern,
    config: Config,
    matcher: Matcher,
    chars: Vec<char>,
}

impl Ranker {
    pub fn new(query: &str, texts: Texts) -> Self {
        // prose scored as paths, whose word starts weigh a little less than in names: a word in a
        // sentence ranks under the same word naming a file, which ranks under a list or panel
        let config = match texts {
            Texts::Names => Config::DEFAULT,
            Texts::Paths | Texts::Prose => Config::DEFAULT.match_paths(),
        };
        let kind = match texts {
            Texts::Names | Texts::Paths => AtomKind::Fuzzy,
            Texts::Prose => AtomKind::Substring,
        };
        Self {
            pattern: Pattern::new(query, CaseMatching::Ignore, Normalization::Smart, kind),
            matcher: Matcher::new(config.clone()),
            config,
            chars: Vec::new(),
        }
    }

    /// Whether nothing was typed: then every text matches, in its order.
    pub fn is_empty(&self) -> bool {
        self.pattern.atoms.is_empty()
    }

    /// The best `limit` texts that match, best first (ties keep the texts' order), and how many
    /// matched in all.
    pub fn best(&mut self, texts: &[&str], limit: usize) -> (Vec<Scored>, usize) {
        let mut scored = self.scores(texts);
        let total = scored.len();
        // the best first, equal scores in the texts' order; only the ones kept are sorted
        let order = |&(score, index): &(u32, usize)| (Reverse(score), index);
        if limit < scored.len() {
            scored.select_nth_unstable_by_key(limit, order);
            scored.truncate(limit);
        }
        scored.sort_unstable_by_key(order);
        let best = scored
            .into_iter()
            .map(|(score, index)| Scored { index, score })
            .collect();
        (best, total)
    }

    /// As `best`, each with its highlights: only the texts kept get them.
    pub fn rank(&mut self, texts: &[&str], limit: usize) -> (Vec<Ranked>, usize) {
        let (best, total) = self.best(texts, limit);
        let ranked = best
            .into_iter()
            .map(|Scored { index, score }| Ranked {
                index,
                score,
                highlights: self.highlights(texts[index]).unwrap_or_default(),
            })
            .collect();
        (ranked, total)
    }

    /// The characters of `text` the query's letters are, in order, if it matches.
    pub fn matched(&mut self, text: &str) -> Option<Vec<u32>> {
        let mut indices = Vec::new();
        let haystack = Utf32Str::new(text, &mut self.chars);
        self.pattern
            .indices(haystack, &mut self.matcher, &mut indices)?;
        // each word of the query adds its own, unsorted
        indices.sort_unstable();
        indices.dedup();
        Some(indices)
    }

    /// Where the query's letters are in `text`, if it matches.
    pub fn highlights(&mut self, text: &str) -> Option<Vec<Highlight>> {
        let indices = self.matched(text)?;
        Some(highlights(text, &indices))
    }

    /// The score of every text that matches, with its position, in the texts' order.
    fn scores(&mut self, texts: &[&str]) -> Vec<(u32, usize)> {
        let threads = threads();
        if texts.len() < PARALLEL_FROM || threads == 1 {
            return score(&self.pattern, &mut self.matcher, &mut self.chars, texts, 0);
        }
        let size = texts.len().div_ceil(threads);
        let pattern = &self.pattern;
        std::thread::scope(|scope| {
            let parts: Vec<_> = texts
                .chunks(size)
                .enumerate()
                .map(|(part, chunk)| {
                    let config = self.config.clone();
                    scope.spawn(move || {
                        let mut matcher = Matcher::new(config);
                        score(pattern, &mut matcher, &mut Vec::new(), chunk, part * size)
                    })
                })
                .collect();
            parts
                .into_iter()
                .flat_map(|part| part.join().expect("scoring does not panic"))
                .collect()
        })
    }
}

/// The score of each text of `texts` that matches, with its position plus `offset`.
fn score(
    pattern: &Pattern,
    matcher: &mut Matcher,
    chars: &mut Vec<char>,
    texts: &[&str],
    offset: usize,
) -> Vec<(u32, usize)> {
    texts
        .iter()
        .enumerate()
        .filter_map(|(index, text)| {
            let score = pattern.score(Utf32Str::new(text, chars), matcher)?;
            Some((score, offset + index))
        })
        .collect()
}

/// Turns the code points that matched, in order, into runs of UTF-16 offsets, as JavaScript
/// counts them.
fn highlights(text: &str, indices: &[u32]) -> Vec<Highlight> {
    let mut wanted = indices.iter().copied().peekable();
    let mut runs: Vec<Highlight> = Vec::new();
    let mut offset = 0u32;
    for (index, char) in (0u32..).zip(text.chars()) {
        let width = char.len_utf16() as u32;
        if wanted.next_if_eq(&index).is_some() {
            match runs.last_mut() {
                Some(run) if run[1] == offset => run[1] += width,
                _ => runs.push([offset, offset + width]),
            }
        }
        offset += width;
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rank(query: &str, texts: Texts, candidates: &[&str]) -> Vec<String> {
        let mut ranker = Ranker::new(query, texts);
        let (ranked, _) = ranker.rank(candidates, usize::MAX);
        ranked
            .into_iter()
            .map(|r| candidates[r.index].to_string())
            .collect()
    }

    #[test]
    fn an_empty_query_keeps_every_text_in_order() {
        let mut ranker = Ranker::new("  ", Texts::Names);
        assert!(ranker.is_empty());
        let (ranked, total) = ranker.rank(&["b", "a"], usize::MAX);
        assert_eq!(total, 2);
        assert_eq!(
            ranked.iter().map(|r| r.index).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert!(ranked.iter().all(|r| r.highlights.is_empty()));
    }

    #[test]
    fn letters_in_order_match_and_others_do_not() {
        assert_eq!(
            rank(
                "dsc",
                Texts::Paths,
                &["src/legacy/discounts.ts", "src/cart.ts"]
            ),
            vec!["src/legacy/discounts.ts"]
        );
        assert!(rank("zz", Texts::Names, &["shop", "docs-site"]).is_empty());
    }

    #[test]
    fn a_file_name_ranks_above_letters_scattered_over_a_path() {
        assert_eq!(
            rank(
                "total",
                Texts::Paths,
                &["src/tests/other/attachments/legal.ts", "src/cart/total.ts"]
            ),
            vec!["src/cart/total.ts", "src/tests/other/attachments/legal.ts"]
        );
    }

    #[test]
    fn words_match_in_any_order_and_case_is_ignored() {
        assert_eq!(
            rank(
                "Total CART",
                Texts::Paths,
                &["src/cart/total.ts", "src/total.ts"]
            ),
            vec!["src/cart/total.ts"]
        );
    }

    #[test]
    fn the_limit_keeps_the_best_and_counts_them_all() {
        let mut ranker = Ranker::new("a", Texts::Names);
        let (ranked, total) = ranker.rank(&["b", "xa", "a", "ya"], 2);
        assert_eq!(total, 3);
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].index, 2);
    }

    #[test]
    fn many_texts_score_on_threads_as_on_one() {
        let texts: Vec<String> = (0..PARALLEL_FROM * 2 + 3)
            .map(|i| format!("src/part{}/file{i}.ts", i % 7))
            .collect();
        let texts: Vec<&str> = texts.iter().map(String::as_str).collect();
        let mut ranker = Ranker::new("part3 file", Texts::Paths);
        let threaded = ranker.scores(&texts);
        let one = score(
            &ranker.pattern,
            &mut ranker.matcher,
            &mut Vec::new(),
            &texts,
            0,
        );
        assert!(!one.is_empty());
        assert_eq!(threaded, one);
    }

    #[test]
    fn highlights_are_runs_of_utf16_offsets() {
        let mut ranker = Ranker::new("tot", Texts::Paths);
        let (ranked, _) = ranker.rank(&["cart/total.ts"], usize::MAX);
        assert_eq!(ranked[0].highlights, vec![[5, 8]]);

        // "é" is one UTF-16 unit, "𝒳" two: offsets after them move by as many
        let mut ranker = Ranker::new("ab", Texts::Names);
        let (ranked, _) = ranker.rank(&["é𝒳a-b"], usize::MAX);
        assert_eq!(ranked[0].highlights, vec![[3, 4], [5, 6]]);
    }

    #[test]
    fn prose_matches_the_words_not_letters_scattered_over_it() {
        let sentence = "Golden rule: measure before and after, nothing runs while idle";
        assert!(rank("seed", Texts::Names, &[sentence]).len() == 1);
        assert!(rank("seed", Texts::Prose, &[sentence]).is_empty());
        assert_eq!(
            rank("idle rule", Texts::Prose, &[sentence, "a rule"]),
            vec![sentence]
        );
    }

    #[test]
    fn a_name_ranks_over_a_file_over_a_sentence_for_one_word() {
        let score = |query: &str, texts: Texts, text: &str| {
            let (ranked, _) = Ranker::new(query, texts).rank(&[text], 1);
            ranked[0].score
        };
        let list = score("seed", Texts::Names, "Seed data");
        let file = score("seed", Texts::Paths, "db/seed.sql");
        let note = score("seed", Texts::Prose, "Add seed data for the e2e tests");
        assert!(list > file && file > note, "{list} {file} {note}");
    }

    #[test]
    fn a_plain_letter_matches_its_accented_form() {
        assert_eq!(rank("cafe", Texts::Names, &["café"]), vec!["café"]);
    }
}
