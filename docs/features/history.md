# History

The commits of the repository on screen as a graph, and the branch switch: the one write
Sidekyk makes.

## Behaviour

- Recent commits, as VS Code's graph by default: HEAD's history and its upstream's, lanes in
  colors (HEAD's the accent, the upstream's its own, a merged branch's in turn); refs named: the
  branch checked out, its upstream, the tags (other branches left out, as VS Code's default
  `scm.graph.badges`); 50 a page, the next read as the list nears its end. A
  commit's files replace the list until `×`/`Esc`; a merge's are what it brought to its first
  parent.
- The graph grows with its lanes, as VS Code's (whose rows have no lane limit), up to a third of
  the row; lanes past it are cut, so the subject keeps two thirds.
- Two places, the section's heading button moving it, the setting `commitsPlace` keeping it: at
  the bottom of the list (default), 40% of its height, one line a commit as VS Code's: subject and
  how long ago, nothing else competing for the width; the lane's color tells the branch. A
  tooltip (500 ms) reads the row whole: the subject on as many lines as it takes, hash, author,
  date to the minute (`15 nov 2026, 08:42`), refs as labels, a branch's icon in its lane's color
  (as VS Code's pills) to tie the name to the line; the details are a click away, in the list. One Base UI tooltip for every
  row (detached triggers), in the menus' style; the native `title` was unreadable. Or under the list and the viewer, the panel's whole width,
  40% of its height: refs as labels (a branch, the upstream's cloud, a tag), author and hash in
  columns too. The commit → files → diff path stays on screen either way; a full-page
  graph (Zed's opens as a tab) would cover the diff.
- Switch branch: a click on the branch in the top bar, as VS Code's status bar, opens a picker:
  local branches, the last committed to first, then remote ones no local branch tracks, ranked as
  the palette ranks names. All of them, as VS Code and Zed list them: a virtualized list, as the
  palette's. A remote one makes the local branch that tracks it,
  as VS Code's "Checkout to...". The one write Sidekyk makes (`../product.md`, Guardrails): git
  refuses a switch that would overwrite changes (`branch_switch_blocked`) or while another git holds
  `index.lock` (`repository_busy`); no stash, no force, no fetch.

## How it is built

- Commits: `git rev-parse --symbolic-full-name @{upstream}` (none on failure), then `git log -z
  --topo-order --decorate=full -n 51 --skip=<read> --ignore-missing --no-show-signature HEAD
  [upstream]` with `%P` and `%D` (HEAD's branch, the upstream and `refs/tags/` kept, in that
  order). `--topo-order`, as
  VS Code's graph, puts children first, which the lanes need: 51 commits of a 40,388-commit
  repository in 10-20 ms with git's commit-graph file, ~0.5 s without. A commit's files `git
  diff-tree -r -z --raw --numstat -M` against its first parent (`--root` for a root), at most
  10,000; ids must be hashes (`invalid_commit`).
- Graph (`model/history/graph.ts`): one pass over the commits read; each lane holds the commit it
  goes down to; a first parent keeps its child's lane, another parent joins the lane going to it
  or takes the first free one. One SVG per virtual row, in a column as wide as the lanes, at most
  a third of the row (CSS, no measuring). An infinite query: a change of HEAD or refs reads again
  the pages read.
- Branches: `git for-each-ref --sort=-committerdate` over `refs/heads` and `refs/remotes`, read as
  the picker opens (`origin/HEAD` and remotes a local branch tracks left out). Switch: `git switch
  --no-guess -- <branch>` or `git switch --track -- <remote>` through `git_write`, given 10 min,
  both with `--no-overwrite-ignore`: git's default replaces an ignored file the branch tracks (a
  local `.env`), so it is refused as a changed file is (`branch_switch_blocked`)
  (a checkout killed midway leaves `index.lock`); hooks run as in a terminal (git-lfs fetches on
  `post-checkout`). Then the watcher sees HEAD move.
