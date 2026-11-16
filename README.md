# Quotaro

Switch AI coding accounts, watch every usage limit, and talk to your running agents, all from one app. Runs on macOS, Linux and Windows.

Built with Electron, React, TypeScript, Tailwind and Motion. The UI is designed in [Google Stitch](https://stitch.withgoogle.com).

Starts from everything [AccountDeck](https://github.com/nadim-sheikh/accountDeck) does. See [docs/accountdeck-features.md](docs/accountdeck-features.md).

## Roadmap

1. **Reset alerts.** A bell on each limit. When the 5-hour or weekly window resets, you get a system notification.
   - Fired by a timer at `resetsAt`, because no file changes when a window resets.
   - One alert per Claude account, even if Claude Code and Claude Desktop share it.
2. **Stats.** Usage over time per account and provider.
   - A sample is saved on every refresh to `~/.switch-man/history.jsonl`.
   - Backfilled from Claude Desktop usage history, Codex session logs, and Claude Code token counts.
3. **Animated, production-grade UI.** Screens designed in Google Stitch, then built with Tailwind and Motion.
4. **Smart providers.** A provider's section shows up only once you've added more than one account for it.
5. **Name.** Quotaro.
6. **Ongoing agents and chats.**
   - Running Claude Code and Codex sessions are listed live: title, folder, account, and last activity.
   - Agents started from Quotaro are owned by the app and take messages directly.
   - Sending to a chat already open in a terminal continues it as a background run with `--resume`.

## What it does

Your data lives in `~/.switch-man` (the folder keeps the app's first name, so existing setups keep working).

- **Accounts.** Claude Code and Codex logins, each in its own folder. Your existing logins show as "Main"; AccountDeck accounts are imported on first run.
- **Switching.** "Connect terminal" adds a hook to `.zshrc` / `.bashrc` that reads `~/.switch-man/env.sh` before every prompt. Windows sets user env vars instead.
- **Limits.** 5-hour and weekly usage per account, read from Claude Code's status line and Codex session logs. No login tokens are read.
  - Turning on tracking wraps the account's status line; your own status line keeps running.
- **Reset alerts.** A bell on each limit sends a system notification when it resets. The app keeps running in the tray.
- **Auto-start at reset.** Per Claude account: a message (default "hi") goes out a minute after each 5-hour reset, so the next window starts right away. Each send reports the exact next reset, which schedules the one after.
- **Stats.** Every change is saved to `~/.switch-man/history.jsonl`, backfilled from existing status files and Codex logs.
- **Agents.** Chats from the last 7 days, with live ones marked. Start a new agent, or message any chat: it continues as a background `--resume` run. A Claude Code chat can be continued on another account: it is copied there and resumed in a terminal.

Not built (yet): Claude Desktop and ChatGPT accounts, exact usage via the Anthropic API, copying setup/MCP between accounts, fish shell.

## Develop

```sh
npm install
npm run dev        # hot-reload app
npm run build      # production build into out/
npm run typecheck
npm test           # parsers and hooks (Node's test runner)
npm run dist       # installers for the current OS
```

Stitch MCP: export `STITCH_API_KEY` in your shell, then start Claude Code in this folder. `.mcp.json` picks it up.
