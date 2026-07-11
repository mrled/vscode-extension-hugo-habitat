// @ts-check
// Locating a file's frontmatter block and computing the edit that sets its
// `date` field to a given time. Pure string logic (no vscode), so it can be
// unit-tested directly; the caller turns the returned offsets into an edit.

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A located frontmatter block.
 *  `format` picks the field syntax (`key: v` vs `key = v`); `innerStart`/
 *  `innerEnd` bound the content between the delimiter lines (exclusive of them).
 *  @typedef {{ format: 'yaml' | 'toml', innerStart: number, innerEnd: number }} Frontmatter */

// Find a leading frontmatter block: a `---` (YAML) or `+++` (TOML) delimiter
// line at the very top of the file, up to the next matching delimiter line. A
// leading UTF-8 BOM is tolerated. Returns null when there is no such block
// (including when the opening delimiter has no closing partner).
/**
 * @param {string} text
 * @returns {Frontmatter | null}
 */
function findFrontmatter(text) {
  let idx = 0;
  if (text.charCodeAt(0) === 0xfeff) idx = 1; // skip BOM

  const firstNl = text.indexOf('\n', idx);
  if (firstNl === -1) return null;
  const opener = text.slice(idx, firstNl).replace(/\r$/, '').trim();
  const format = opener === '---' ? 'yaml' : opener === '+++' ? 'toml' : null;
  if (!format) return null;

  const innerStart = firstNl + 1;
  let lineStart = innerStart;
  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    if (line.trim() === opener) {
      return { format, innerStart, innerEnd: lineStart };
    }
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  return null; // opening delimiter with no closing partner
}

// Format a Date as an RFC 3339 timestamp in local time with a numeric offset,
// e.g. "2026-07-11T14:32:07-05:00" — the shape Hugo writes for `date` fields.
/**
 * @param {Date} d
 * @returns {string}
 */
function formatRfc3339(d) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const offset = sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    offset
  );
}

/** A text replacement over `[start, end)` in the document. `end === start`
 *  means an insertion. @typedef {{ start: number, end: number, newText: string }} Edit */

// Compute the edit that sets the frontmatter `date` field to `date`. If a
// top-level `date` key already exists its line is rewritten in place (keeping
// indentation and key casing, normalizing the spacing around the separator);
// otherwise a new `date` line is inserted at the top of the block. Returns null
// when the file has no frontmatter block for us to edit.
/**
 * @param {string} text
 * @param {Date} [date]
 * @returns {Edit | null}
 */
function dateFieldEdit(text, date = new Date()) {
  const fm = findFrontmatter(text);
  if (!fm) return null;

  const sep = fm.format === 'toml' ? '=' : ':';
  // TOML writes `key = value`; YAML writes `key: value` (no space before ':').
  const assign = fm.format === 'toml' ? ' = ' : ': ';
  const value = formatRfc3339(date);
  const inner = text.slice(fm.innerStart, fm.innerEnd);
  const keyRe = new RegExp('^([ \\t]*)(date)[ \\t]*' + escapeRegex(sep) + '[^\\r\\n]*', 'mi');
  const km = keyRe.exec(inner);

  if (km) {
    const start = fm.innerStart + km.index;
    return {
      start,
      end: start + km[0].length,
      newText: km[1] + km[2] + assign + value,
    };
  }
  // No existing date field: insert one as the first line of the block.
  return { start: fm.innerStart, end: fm.innerStart, newText: 'date' + assign + value + '\n' };
}

module.exports = {
  findFrontmatter,
  formatRfc3339,
  dateFieldEdit,
};
