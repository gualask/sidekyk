/**
 * The columns of a row of a project's folders, the same in every row so they line up (the menu in
 * the breadcrumb, the dialog asking which to open): what names the folder, then `FolderFacts`'
 * three cells: the branch, the files changed, the lines, these two of a fixed width. Name and
 * branch share what the counts leave.
 */
export const FOLDER_COLUMNS =
    'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_4.5rem] items-center gap-x-3';
