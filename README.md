# twitter-tui

A record-style terminal UI for Twitter/X: Bun + TypeScript, raw ANSI rendering, modal prompt editing, whale/cerberus themes, a focused timeline cursor, and a polished sidebar/statusline.

It reuses an existing `twitter` CLI login/API bridge. If `twitter timeline` works on your machine, this TUI can use the same session.

## Requirements

- [Bun](https://bun.sh/)
- A working `twitter` CLI in `PATH`
- The `twitter-cli` source tree available to the JSON bridge
  - default: `~/Workspace/exocortex/external-tools/twitter-cli`
  - override with `TWITTER_CLI_ROOT=/path/to/twitter-cli`

## Run

```bash
bun install
./bin/twitter-tui
```

or:

```bash
bun run start
```

## Controls

- `Ctrl-S` / `Ctrl-M`: toggle sidebar
- `Ctrl-J` / `Ctrl-K`: cycle sidebar/content focus
- `Ctrl-N`: toggle prompt/timeline focus
- Timeline focus: `j/k` move the cursor by rendered line, `h/l` move horizontally, `0/$` line start/end, `g/G` top/bottom
- Prompt focus: vim-style modal editing copied from record, including chained actions like `dd`
- `Enter`: activate sidebar view, open selected DM conversation, or open configured targets under the timeline cursor
- `r`: reply to selected tweet
- `Q`: quote selected tweet
- `b`: bookmark selected tweet
- `R`: retweet selected tweet
- `o`: open selected tweet/profile/trend URL
- `/`: command prompt

## Commands

```text
/login <saved-login|auth_token ct0|cookie-string|json>
/logout
/theme whale|cerberus
/quit
```

Plain text in the prompt posts a tweet, replies if a reply target is active, or sends a DM when inside a DM conversation.

## Openers

`Enter` on timeline content uses the same configurable opener model as record. Configure `~/.config/twitter-tui/config.json`:

```json
{
  "openers": {
    "url": { "command": "xdg-open", "args": ["{target}"] },
    "rules": [
      { "extensions": ["png", "jpg", "jpeg", "webp", "pdf"], "command": "show", "args": ["{path}"] },
      { "extensions": ["mp4", "webm", "mp3", "wav"], "command": "st", "args": ["-e", "zsh", "-ic", "exec audio-play {path:sh}"] }
    ]
  }
}
```

Templates supported: `{target}`, `{path}`, `{target:sh}`, `{path:sh}`.

## License

MIT
