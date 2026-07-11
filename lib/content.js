// @ts-check
// Content indexing: mapping a Hugo `content/` tree to "logical paths" (the
// path Hugo addresses a page by) and finding files that match a reference.

const fs = require('fs');
const path = require('path');

/** A content file and its logical-path segments. @typedef {{ segments: string[], file: string }} Entry */

/** @type {Map<string, Entry[]>} contentRoot -> entries */
const indexCache = new Map();

// Walk up a file's path to the enclosing Hugo `content` directory.
// Returns the absolute path of that directory, or null if the file is not
// inside one (the extension only acts on files under content/).
/**
 * @param {string} filePath
 * @returns {string | null}
 */
function findContentRoot(filePath) {
  const segments = filePath.split(path.sep);
  const idx = segments.indexOf('content');
  if (idx === -1) return null;
  return segments.slice(0, idx + 1).join(path.sep);
}

// The "logical path" of a content file: its path relative to content/, minus
// the extension, minus a trailing index/_index (with optional .lang) segment.
//   content/blog/area51/index.md   -> ["blog", "area51"]
//   content/tags/area51/_index.md  -> ["tags", "area51"]
//   content/area51/posts/slug.md   -> ["area51", "posts", "slug"]
/**
 * @param {string} contentRoot
 * @param {string} file
 * @returns {string[]}
 */
function logicalSegments(contentRoot, file) {
  let rel = path.relative(contentRoot, file).replace(/\\/g, '/');
  rel = rel.replace(/\.(md|markdown|html?)$/i, '');
  const segs = rel.split('/').filter(Boolean);
  if (segs.length && /^_?index(\.[\w-]+)?$/i.test(segs[segs.length - 1])) segs.pop();
  return segs;
}

/**
 * @param {string} contentRoot
 * @returns {Entry[]}
 */
function buildIndex(contentRoot) {
  /** @type {Entry[]} */
  const entries = [];
  /** @param {string} dir */
  const walk = (dir) => {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (it.name === '.git' || it.name === 'node_modules') continue;
        walk(full);
      } else if (it.isFile() && /\.(md|markdown|html?)$/i.test(it.name)) {
        entries.push({ segments: logicalSegments(contentRoot, full), file: full });
      }
    }
  };
  walk(contentRoot);
  return entries;
}

/**
 * @param {string} contentRoot
 * @returns {Entry[]}
 */
function getIndex(contentRoot) {
  let idx = indexCache.get(contentRoot);
  if (!idx) {
    idx = buildIndex(contentRoot);
    indexCache.set(contentRoot, idx);
  }
  return idx;
}

// A reference matches a file when the reference segments are a suffix of the
// file's logical-path segments (on segment boundaries). This unifies:
//   - bare unique name:  ["slug"]
//   - full path:         ["area51", "posts", "slug"]
//   - unique path tail:  ["subsection", "area51"]
/**
 * @param {Entry[]} index
 * @param {string[]} refSegs
 * @returns {Entry[]}
 */
function matchFiles(index, refSegs) {
  if (!refSegs.length) return [];
  return index.filter((e) => {
    if (e.segments.length < refSegs.length) return false;
    const tail = e.segments.slice(e.segments.length - refSegs.length);
    return tail.every((s, i) => s.toLowerCase() === refSegs[i].toLowerCase());
  });
}

/** Clear the cached index so it is rebuilt on next use. */
function clearIndexCache() {
  indexCache.clear();
}

module.exports = {
  findContentRoot,
  logicalSegments,
  getIndex,
  matchFiles,
  clearIndexCache,
};
