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
- `Enter`: activate sidebar view, open selected DM conversation, or load selected tweet thread
- `r`: reply to selected tweet
- `Q`: quote selected tweet
- `b`: bookmark selected tweet
- `R`: retweet selected tweet
- `o`: open selected tweet/profile/trend URL
- `/`: command prompt

## Commands

```text
/home
/latest
/search <query>
/user @handle
/profile @handle
/tweet <id-or-url>
/thread [id-or-url]
/notifications
/bookmarks
/trending
/dms
/dm <conversation-id|@handle>
/post <text>
/reply [tweet] <text>
/quote [tweet] <text>
/like [tweet]
/unlike [tweet]
/rt [tweet]
/unrt [tweet]
/bookmark [tweet]
/delete <tweet>
/open [url]
/theme whale|cerberus
/help
/quit
```

Plain text in the prompt posts a tweet, replies if a reply target is active, or sends a DM when inside a DM conversation.

## License

MIT
