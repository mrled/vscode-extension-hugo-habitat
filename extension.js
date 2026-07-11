// Hugo QOL — clickable ref/relref shortcode links.
//
// Pure stdlib: only the built-in `vscode`, `fs`, and `path` modules are used,
// so there is nothing to compile and no npm packages to install.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// contentRoot -> [{ segments: string[], file: string }]
const indexCache = new Map();

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Walk up a file's path to the enclosing Hugo `content` directory.
// Returns the absolute path of that directory, or null if the file is not
// inside one (the extension only acts on files under content/).
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
function logicalSegments(contentRoot, file) {
  let rel = path.relative(contentRoot, file).replace(/\\/g, '/');
  rel = rel.replace(/\.(md|markdown|html?)$/i, '');
  const segs = rel.split('/').filter(Boolean);
  if (segs.length && /^_?index(\.[\w-]+)?$/i.test(segs[segs.length - 1])) segs.pop();
  return segs;
}

function buildIndex(contentRoot) {
  const entries = [];
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

function getIndex(contentRoot) {
  if (!indexCache.has(contentRoot)) indexCache.set(contentRoot, buildIndex(contentRoot));
  return indexCache.get(contentRoot);
}

// Which shortcode names are treated as references. `ref` and `relref` are
// always recognized; any "shortcodes" listed in habitat.json (in the primary
// Hugo directory, the one that holds content/) are added on top.
function getShortcodes(contentRoot) {
  const names = ['ref', 'relref'];
  const projectRoot = path.dirname(contentRoot);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'habitat.json'), 'utf8'));
    if (Array.isArray(cfg.shortcodes)) {
      for (const s of cfg.shortcodes) {
        if (typeof s === 'string' && s.length && !names.includes(s)) names.push(s);
      }
    }
  } catch {
    // no config, or invalid — just the defaults
  }
  return names;
}

// Normalize a shortcode argument into path segments to look up.
// Handles quotes, a leading/trailing slash, a #fragment, and a trailing
// .md/.html on the last segment.
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
function matchFiles(index, refSegs) {
  if (!refSegs.length) return [];
  return index.filter((e) => {
    if (e.segments.length < refSegs.length) return false;
    const tail = e.segments.slice(e.segments.length - refSegs.length);
    return tail.every((s, i) => s.toLowerCase() === refSegs[i].toLowerCase());
  });
}

function computeAll(document) {
  const links = [];
  const diagnostics = [];

  const contentRoot = findContentRoot(document.uri.fsPath);
  if (!contentRoot) return { links, diagnostics };

  const index = getIndex(contentRoot);
  const alt = getShortcodes(contentRoot)
    .slice()
    .sort((a, b) => b.length - a.length) // longer names first so alternation is unambiguous
    .map(escapeRegex)
    .join('|');
  // {{< name arg  or  {{% name arg  ; arg is quoted or a bare token.
  const re = new RegExp('\\{\\{[<%]\\s*(' + alt + ')\\s+("[^"]*"|\'[^\']*\'|[^\\s%>]+)', 'g');

  const text = document.getText();
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[2];
    // The regex ends exactly at the end of the argument token, so:
    const argEnd = m.index + m[0].length;
    const argStart = argEnd - token.length;

    // Underline just the slug; drop surrounding quotes from the clickable range.
    let innerStart = argStart;
    let innerEnd = argEnd;
    if (token.length >= 2 && (token[0] === '"' || token[0] === "'") && token[token.length - 1] === token[0]) {
      innerStart += 1;
      innerEnd -= 1;
    }
    const range = new vscode.Range(document.positionAt(innerStart), document.positionAt(innerEnd));

    const refSegs = parseRef(token);
    const found = matchFiles(index, refSegs);
    const label = refSegs.join('/');

    if (found.length === 1) {
      const link = new vscode.DocumentLink(range, vscode.Uri.file(found[0].file));
      link.tooltip = 'Hugo: ' + path.relative(contentRoot, found[0].file);
      links.push(link);
    } else if (found.length === 0) {
      diagnostics.push(new vscode.Diagnostic(
        range,
        'Hugo QOL: no content file matches "' + label + '".',
        vscode.DiagnosticSeverity.Warning
      ));
    } else {
      const list = found.map((f) => path.relative(contentRoot, f.file)).join(', ');
      diagnostics.push(new vscode.Diagnostic(
        range,
        'Hugo QOL: reference "' + label + '" is ambiguous — ' + found.length + ' matches: ' + list + '.',
        vscode.DiagnosticSeverity.Error
      ));
    }
  }

  return { links, diagnostics };
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('hugoqol');
  context.subscriptions.push(diagnostics);

  const selector = [{ language: 'markdown' }, { language: 'html' }];
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks(document) {
        const { links, diagnostics: diags } = computeAll(document);
        diagnostics.set(document.uri, diags);
        return links;
      },
    })
  );

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

  // Rebuild the file index whenever content files (or the config) change.
  const invalidate = () => indexCache.clear();
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
