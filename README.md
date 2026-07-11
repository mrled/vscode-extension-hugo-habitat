# Hugo Habitat

A VS Code extension that makes working with Hugo sites nicer.

## Features

No build step, no npm install ---
it's plain JavaScript using only the Node and VS Code standard libraries.

### A clickable jump-to-file glyph for every reference

In any Markdown or HTML file under a Hugo `content/` directory, it resolves
references against the files in `content/` and renders a small clickable `[↗]`
glyph right after each one. Cmd/Ctrl-click the glyph to open the referenced
content file. The same interaction works for every reference type below.

It recognises **reference shortcodes** — bare unique names, paths relative to
the content directory, or unique tails:

- `{{< ref unique-slug >}}`
- `{{< relref "/area51/posts/unique-slug" >}}`
- `{{< ref "/subsection/area51" >}}`

And it recognises **ordinary Markdown links** whose target is a Hugo logical
path (the leading slash is optional — `blog/whatever` is treated the same as
`/blog/whatever`):

- `[Improving argparse docs](/blog/argparse-improving-docs-generation)`
- `[Improving argparse docs](blog/argparse-improving-docs-generation)`

Markdown links with a URL scheme (`https:`, `mailto:`, …), an in-page
`#anchor`, or an explicitly relative `./` or `../` path are ignored and left to
VS Code's built-in handling.

Both resolve to files like:

- `content/subsection/unique-slug/index.md`
- `content/blog/_index.md`
- `content/blog/section/subsection/area51/index.md`
- `content/blog/post.md`

This works for both `.md` and `.html` files.

Exactly one file must match, else it will show a warning squiggle and an error listing candidates
(e.g. if both `slug.md` and `slug/index.md` exist).

The glyph is an [inlay hint](https://code.visualstudio.com/docs/editor/editingevolved),
so it needs `editor.inlayHints.enabled` to be on (the default). A plain
DocumentLink over the link text can't be used for Markdown links, because VS
Code's built-in Markdown link provider claims the same range and wins the
cmd-click; the inlay glyph is a separate inline element, so it sidesteps that
collision and behaves the same for shortcodes and Markdown links alike.

#### Limitations

- Ordinary Markdown links don't actually work for Hugo sites;
  there is no way for a link like `[blog](/blog)` to resolve to `content/blog/` in the repo
- I could not override default behavior of clickable ordinary Markdown links
- An annotation can be directly clickable, so that's what we used
- I could have made `{{< ref ... >}}` links directly clickable, but I wanted to be consistent instead
- I tested CodeLense, which would put clickable information in a hover panel above the Markdown link;
  this worked but meant you had to hover, move mouse, then cmd-click, which was awkward
- There are not really any color options for annotations like our `[↗]` glyph;
  technically we could set `InlayHintKind` to `Parameter` or `Type`, but at least in my theme, these are all the same as the default

#### Custom shortcodes

It detects `ref` and `relref` shortcodes by default.
You can add to this list by setting `shortcodes` in the config file,
for instance, if you have a `page` shortcode: `"shortcodes": ["page"]`.

### Open the current page in a browser

Run **Hugo Habitat: Open in Browser** from the command palette to open that file in your browser.
Requires `hugo server` to be running.
Uses `baseurl` in the config, or defaults to `http://localhost:1313`.
Examples:

- `content/blog/area51/index.md` → `<baseurl>/blog/area51/`
- `content/_index.md` → `<baseurl>/`

## Configuration

`habitat.json` in the root directory.

```json
{
  "baseurl": "https://example.com",
  "shortcodes": ["page"]
}
```

## Installing

Because the extension needs no compilation, you can run it straight from a
git checkout by symlinking it into your VS Code extensions folder:

```sh
ln -s "$PWD" ~/.vscode/extensions/mrled.hugo-habitat
```

Then open the command palette and invoke "Developer: Reload Window".
Reloading this way is required for every source code update.

When editing the extension, open the folder in VS Code and press <kbd>F5</kbd> to
launch an Extension Development Host.

## License

MIT
