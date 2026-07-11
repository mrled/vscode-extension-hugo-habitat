// @ts-check
// Reading `habitat.json` (the per-project config) and deriving values from it:
// the recognized shortcode names and the base URL for opening pages in a
// browser.

const fs = require('fs');
const path = require('path');
const { logicalSegments } = require('./content');

// Read habitat.json from the primary Hugo directory (the one that holds
// content/, i.e. the parent of contentRoot). Returns {} when it's missing or
// invalid, so callers can just read the fields they care about.
/**
 * @param {string} contentRoot
 * @returns {Record<string, any>}
 */
function readConfig(contentRoot) {
  const projectRoot = path.dirname(contentRoot);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'habitat.json'), 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {}; // no config, or invalid
  }
}

// Which shortcode names are treated as references. `ref` and `relref` are
// always recognized; any "shortcodes" listed in habitat.json (in the primary
// Hugo directory, the one that holds content/) are added on top.
/**
 * @param {string} contentRoot
 * @returns {string[]}
 */
function getShortcodes(contentRoot) {
  const names = ['ref', 'relref'];
  const cfg = readConfig(contentRoot);
  if (Array.isArray(cfg.shortcodes)) {
    for (const s of cfg.shortcodes) {
      if (typeof s === 'string' && s.length && !names.includes(s)) names.push(s);
    }
  }
  return names;
}

// The base URL that "Open in browser" builds page URLs on top of. Defaults to
// the `hugo server` address; override it by setting `baseurl` in habitat.json
// (e.g. "https://example.com"). Any trailing slashes are trimmed.
const DEFAULT_BASE_URL = 'http://localhost:1313';
/**
 * @param {string} contentRoot
 * @returns {string}
 */
function getBaseUrl(contentRoot) {
  const cfg = readConfig(contentRoot);
  const raw = cfg.baseurl ?? cfg.baseURL;
  const base = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, '');
}

// The browsable URL for a content file: the base URL joined with the file's
// logical-path segments, with a trailing slash (Hugo's default "pretty" URLs).
//   content/blog/area51/index.md  -> <base>/blog/area51/
//   content/_index.md             -> <base>/
/**
 * @param {string} contentRoot
 * @param {string} file
 * @returns {string}
 */
function browserUrlFor(contentRoot, file) {
  const segs = logicalSegments(contentRoot, file).map((s) => encodeURIComponent(s));
  return getBaseUrl(contentRoot) + '/' + (segs.length ? segs.join('/') + '/' : '');
}

module.exports = {
  getShortcodes,
  getBaseUrl,
  browserUrlFor,
  DEFAULT_BASE_URL,
};
