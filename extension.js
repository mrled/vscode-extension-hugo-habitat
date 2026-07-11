// @ts-check
// Hugo Habitat - personal VS Code extension for better Hugo content authoring
//
// Pure stdlib at runtime: only the built-in `vscode`, `fs`, and `path` modules
// are used, so there is nothing to compile and no npm packages to install. The
// `// @ts-check` above plus JSDoc types give editor/`tsc` type-checking without
// TypeScript; `@types/vscode` is a dev-only dependency for that checking.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/** A content file and its logical-path segments. @typedef {{ segments: string[], file: string }} Entry */

/** @type {Map<string, Entry[]>} contentRoot -> entries */
const indexCache = new Map();

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
 * @param {Entry[]} index
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

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('hugohabitat');
  context.subscriptions.push(diagnostics);

  const selector = [{ language: 'markdown' }, { language: 'html' }];

  // Command the marker glyph invokes when clicked. A label part's `command` is
  // reliably fired on click, unlike `location`, which is inconsistent.
  const OPEN_COMMAND = 'hugohabitat.openReference';
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_COMMAND, (/** @type {string} */ file) => {
      return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    })
  );

  // Open the current content file's rendered page in a web browser. The URL is
  // built from the file's logical Hugo path on top of the base URL (the
  // `hugo server` default, or `baseurl` from habitat.json). Only works for
  // files under a content/ directory.
  context.subscriptions.push(
    vscode.commands.registerCommand('hugohabitat.openInBrowser', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Hugo Habitat: no active editor to open.');
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const contentRoot = findContentRoot(filePath);
      if (!contentRoot) {
        vscode.window.showWarningMessage('Hugo Habitat: this file is not inside a Hugo content/ directory.');
        return;
      }
      const url = browserUrlFor(contentRoot, filePath);
      return vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  // A single inline provider handles both reference shortcodes and Hugo-style
  // Markdown links: every resolved reference gets a clickable `↗` glyph placed
  // right after it. Clicking the glyph runs OPEN_COMMAND to open the content
  // file. Using an inlay hint (rather than a DocumentLink over the link text)
  // means we don't collide with VS Code's built-in Markdown link on the same
  // range, so refs and Markdown links behave identically.
  /** @type {vscode.EventEmitter<void>} */
  const onDidChangeInlayHints = new vscode.EventEmitter();
  context.subscriptions.push(onDidChangeInlayHints);
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(selector, {
      onDidChangeInlayHints: onDidChangeInlayHints.event,
      provideInlayHints(document, range) {
        const { markers, diagnostics: diags } = computeAll(document);
        diagnostics.set(document.uri, diags);
        /** @type {vscode.InlayHint[]} */
        const hints = [];
        for (const mk of markers) {
          if (!range.contains(mk.position)) continue;
          const part = new vscode.InlayHintLabelPart('[↗]');
          part.command = { title: 'Open ' + mk.rel, command: OPEN_COMMAND, arguments: [mk.file] };
          part.tooltip = 'Hugo: ' + mk.rel;
          const hint = new vscode.InlayHint(mk.position, [part]);
          hint.paddingLeft = true;
          hints.push(hint);
        }
        return hints;
      },
    })
  );

  /** @param {vscode.TextDocument} [document] */
  const refresh = (document) => {
    if (!document || (document.languageId !== 'markdown' && document.languageId !== 'html')) return;
    diagnostics.set(document.uri, computeAll(document).diagnostics);
  };
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri))
  );
  vscode.workspace.textDocuments.forEach(refresh);

  // Rebuild the file index whenever content files (or the config) change, and
  // ask VS Code to re-request inlay hints since resolution may now differ.
  const invalidate = () => {
    indexCache.clear();
    onDidChangeInlayHints.fire();
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,markdown,html,htm}');
  watcher.onDidCreate(invalidate);
  watcher.onDidDelete(invalidate);
  const cfgWatcher = vscode.workspace.createFileSystemWatcher('**/habitat.json');
  cfgWatcher.onDidCreate(invalidate);
  cfgWatcher.onDidChange(invalidate);
  cfgWatcher.onDidDelete(invalidate);
  context.subscriptions.push(watcher, cfgWatcher);
}

exports.activate = activate;
exports.deactivate = function () {};
