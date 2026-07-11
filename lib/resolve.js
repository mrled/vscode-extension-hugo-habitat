// @ts-check
// Turning a document's text into clickable markers and diagnostics: parsing
// reference shortcodes and Hugo-style Markdown links, resolving them against
// the content index, and recording where a glyph or squiggle should go.

const vscode = require('vscode');
const path = require('path');
const { findContentRoot, getIndex, matchFiles } = require('./content');
const { getShortcodes } = require('./config');

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize a shortcode argument into path segments to look up.
// Handles quotes, a leading/trailing slash, a #fragment, and a trailing
// .md/.html on the last segment.
/**
 * @param {string} token
 * @returns {string[]}
 */
function parseRef(token) {
  let t = token.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    t = t.slice(1, -1);
  }
  t = t.split('#')[0].replace(/^\/+|\/+$/g, '');
  const segs = t.split('/').filter(Boolean);
  if (segs.length) {
    segs[segs.length - 1] = segs[segs.length - 1].replace(/\.(md|markdown|html?)$/i, '');
  }
  return segs;
}

/** A clickable marker to render after a resolved reference.
 *  @typedef {{ position: vscode.Position, file: string, rel: string }} Marker */

// Resolve a set of reference segments against the index and, depending on the
// number of matches, record a clickable marker or a diagnostic. `markerAt` is
// where the marker glyph should be placed (after the whole link construct),
// while `range` is the span the diagnostic squiggle should cover. `warnOnMissing`
// controls whether a zero-match reference is flagged: shortcodes are always
// meant to resolve (so we warn), but a Markdown link that doesn't resolve is
// probably an ordinary link, so we stay silent and leave it to VS Code.
/**
 * @param {import('./content').Entry[]} index
 * @param {string} contentRoot
 * @param {vscode.Range} range
 * @param {vscode.Position} markerAt
 * @param {string[]} refSegs
 * @param {Marker[]} markers
 * @param {vscode.Diagnostic[]} diagnostics
 * @param {boolean} warnOnMissing
 */
function resolveInto(index, contentRoot, range, markerAt, refSegs, markers, diagnostics, warnOnMissing) {
  if (!refSegs.length) return;
  const found = matchFiles(index, refSegs);
  const label = refSegs.join('/');

  if (found.length === 1) {
    markers.push({ position: markerAt, file: found[0].file, rel: path.relative(contentRoot, found[0].file) });
  } else if (found.length === 0) {
    if (warnOnMissing) {
      diagnostics.push(new vscode.Diagnostic(
        range,
        'Hugo Habitat: no content file matches "' + label + '".',
        vscode.DiagnosticSeverity.Warning
      ));
    }
  } else {
    const list = found.map((f) => path.relative(contentRoot, f.file)).join(', ');
    diagnostics.push(new vscode.Diagnostic(
      range,
      'Hugo Habitat: reference "' + label + '" is ambiguous — ' + found.length + ' matches: ' + list + '.',
      vscode.DiagnosticSeverity.Error
    ));
  }
}

/**
 * @param {vscode.TextDocument} document
 * @returns {{ markers: Marker[], diagnostics: vscode.Diagnostic[] }}
 */
function computeAll(document) {
  /** @type {Marker[]} */
  const markers = [];
  /** @type {vscode.Diagnostic[]} */
  const diagnostics = [];

  const contentRoot = findContentRoot(document.uri.fsPath);
  if (!contentRoot) return { markers, diagnostics };

  const index = getIndex(contentRoot);
  const text = document.getText();

  const alt = getShortcodes(contentRoot)
    .slice()
    .sort((a, b) => b.length - a.length) // longer names first so alternation is unambiguous
    .map(escapeRegex)
    .join('|');
  // {{< name arg  or  {{% name arg  ; arg is quoted or a bare token.
  const re = new RegExp('\\{\\{[<%]\\s*(' + alt + ')\\s+("[^"]*"|\'[^\']*\'|[^\\s%>]+)', 'g');

  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[2];
    // The regex ends exactly at the end of the argument token, so:
    const argEnd = m.index + m[0].length;
    const argStart = argEnd - token.length;

    // Squiggle just the slug; drop surrounding quotes from the diagnostic range.
    let innerStart = argStart;
    let innerEnd = argEnd;
    if (token.length >= 2 && (token[0] === '"' || token[0] === "'") && token[token.length - 1] === token[0]) {
      innerStart += 1;
      innerEnd -= 1;
    }
    const range = new vscode.Range(document.positionAt(innerStart), document.positionAt(innerEnd));

    // Place the marker glyph after the shortcode's closing delimiter (>}} / %}}),
    // so it sits at the end of the whole construct rather than mid-syntax.
    const close = text.indexOf('}}', argEnd);
    const markerAt = document.positionAt(close === -1 ? argEnd : close + 2);
    resolveInto(index, contentRoot, range, markerAt, parseRef(token), markers, diagnostics, true);
  }

  // Also resolve ordinary Markdown links whose target is a Hugo logical path,
  // e.g. [text](blog/whatever) or [text](/blog/whatever). Both are treated as
  // content-root references (the leading slash is optional and normalized away
  // by parseRef). We only add a marker when the target resolves to exactly one
  // content file; targets with a URL scheme, an in-page #anchor, or an
  // explicitly relative ./ or ../ path are left to VS Code's built-in handling.
  if (document.languageId === 'markdown') {
    const mdRe = /(\[[^\]]*\]\()([^)\s]+)([^)]*\))/g;
    let mm;
    while ((mm = mdRe.exec(text)) !== null) {
      const target = mm[2];
      if (/^\w[\w+.-]*:/.test(target)) continue; // has a URL scheme (http:, mailto:, ...)
      if (target[0] === '#') continue;            // in-page anchor
      if (target[0] === '.') continue;            // explicitly relative
      const targetStart = mm.index + mm[1].length;
      const range = new vscode.Range(
        document.positionAt(targetStart),
        document.positionAt(targetStart + target.length)
      );
      // Marker goes after the closing paren of the whole [text](target) link.
      const markerAt = document.positionAt(mm.index + mm[0].length);
      resolveInto(index, contentRoot, range, markerAt, parseRef(target), markers, diagnostics, false);
    }
  }

  return { markers, diagnostics };
}

module.exports = {
  computeAll,
};
