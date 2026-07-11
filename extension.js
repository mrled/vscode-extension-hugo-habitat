// @ts-check
// Hugo Habitat - personal VS Code extension for better Hugo content authoring
//
// Pure stdlib at runtime: only the built-in `vscode`, `fs`, and `path` modules
// are used, so there is nothing to compile and no npm packages to install. The
// `// @ts-check` above plus JSDoc types give editor/`tsc` type-checking without
// TypeScript; `@types/vscode` is a dev-only dependency for that checking.
//
// This file is the entry point (wiring up commands, providers, and watchers).
// The actual logic lives in ./lib: content indexing (content.js), habitat.json
// config and URL building (config.js), and reference resolution (resolve.js).
// Modules are plain CommonJS `require`s, so there is still no build step.

const vscode = require('vscode');
const { findContentRoot, clearIndexCache } = require('./lib/content');
const { browserUrlFor } = require('./lib/config');
const { computeAll } = require('./lib/resolve');
const { dateFieldEdit } = require('./lib/frontmatter');

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

  // Set the current file's frontmatter `date` field to now. Works on any file
  // with a `---` (YAML) or `+++` (TOML) frontmatter block: an existing `date`
  // is rewritten in place, otherwise one is inserted at the top of the block.
  context.subscriptions.push(
    vscode.commands.registerCommand('hugohabitat.updateDate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Hugo Habitat: no active editor to update.');
        return;
      }
      const doc = editor.document;
      const edit = dateFieldEdit(doc.getText());
      if (!edit) {
        vscode.window.showWarningMessage('Hugo Habitat: no frontmatter block found to update.');
        return;
      }
      const range = new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end));
      await editor.edit((b) => b.replace(range, edit.newText));
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
          part.tooltip = 'Hugo Habitat: ' + mk.rel;
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
    clearIndexCache();
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
