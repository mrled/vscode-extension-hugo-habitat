# Hugo Habitat

A VS Code extension that makes working with Hugo sites nicer.

## Features

No build step, no npm install ---
it's plain JavaScript using only the Node and VS Code standard libraries.

### Turn reference shortcodes into clickable links

In any Markdown or HTML file under a Hugo `content/` directory,
it detects references to bare unique names, paths relative to the content directory, or unique tails, for example:

- `{{< ref unique-slug >}}`
- `{{< relref "/area51/posts/unique-slug" >}}`
- `{{< ref "/subsection/area51" >}}`

Referenceds

It turns them into clickable links for files like:

- `content/subsection/unique-slug/index.md`
- `content/blog/_index.md`
- `content/blog/section/subsection/area51/index.md`
- `content/blog/post.md`

This works for both `.md` and `.html` files.

Exactly one file must match, else it will show a warning squiggle and an error listing candidates
(e.g. if both `slug.md` and `slug/index.md` exist).

It detects `ref` and `relref` shortcodes by default.
You can add to this list by setting `shortcodes` in the config file,
for instance, if you have a `page` shortcode: `"shortcodes": ["page"]`.

## Configuration

`habitat.json` in the root directory.

```json
{
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
