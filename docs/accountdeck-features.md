# AccountDeck feature inventory

What switch-man starts from: every feature in [AccountDeck](https://github.com/nadim-sheikh/accountDeck) (MIT, commit `57b7049`), read from the code.

Refs point at a local copy at `~/work/accountDeck` on the `widget` branch. In `mac/Sources/main.swift`, refs after line 1026 sit 18 lines lower than upstream (local widget edits).

**Abbreviations**
- Services: **CC** Claude Code · **CD** Claude Desktop · **CX** Codex · **GPT** ChatGPT
- Files: `M` main.swift · `D` Dashboard.swift · `H` Home.swift · `E` ExactUsage.swift · `S` ChatSync.swift · `W/` windows/src/

## 1. Account management & switching

| Feature | What the user gets | How it works | Services |
|---|---|---|---|
| Main accounts | Existing logins appear as "Main" | `ensureDefaults` M:153-169 creates `desktop-default`, `claude-default` (`~/.claude`) and `codex-default` (`~/.codex`). These can't be removed. | CD, CC, CX |
| Add account | Pick an app, name it, sign in | `add` M:285-300 creates `~/.accountdeck/<service>/<id>`, then runs sign-in. | all |
| CC / CX switch | The next command in any zsh window uses the chosen account | `select` M:269-283 → `writeEnv` M:176-189 writes `~/.accountdeck/env.sh` (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). The zshrc precmd hook sources it. | CC, CX |
| CD switch | Claude quits, its login files are swapped, then it relaunches | `switchDesktop` M:412-465: confirm, then terminate (polls up to 60 s), then swap `Cookies`, `Cookies-journal`, `config.json` (M:569-610, one-time `_original-backup`), then relaunch. | CD |
| CC follows CD | After a CD switch, CC switches to the same Claude account | `followDesktopInCode` M:479-489 matches `lastKnownAccountUuid` against `oauthAccount.accountUuid`. | CD→CC |
| ChatGPT profiles | Each account is its own browser profile | `openBrowser` M:634-645 runs Chrome/Brave/Edge/Chromium with `--user-data-dir`. | GPT |
| Sign in | A terminal runs `claude /login` or `codex login` for that account | `signIn` M:320-342 → `runInTerminal` M:624-632 (self-deleting `.command` file). | CC, CX |
| Sign-in status | Email or status line per row | `refresh` M:215-250: `.claude.json` oauthAccount; Codex `auth.json` JWT email; CD Cookies file exists; GPT `Default/` exists. | all |
| Rename / Remove / Show in Finder | Basic account management | M:346-378. Remove moves the folder to the Trash. | non-Main |
| New Terminal | A terminal with env.sh loaded | M:380-386 | CC, CX |
| Launch at login | Toggle | `SMAppService` M:392-398 | — |

## 2. Usage / limits tracking

- **CC via the status-line hook**
  - `~/.accountdeck/claude-status.sh` (M:1233-1246) saves Claude Code's status-line JSON per session to `<cfg>/.accountdeck-status/<session_id>.json`.
  - Installed into each account's `settings.json` `statusLine` (M:1252-1274), with a backup. Skipped if the account already has its own status line.
  - Parsed from `rate_limits.five_hour` / `seven_day` (M:1197-1215).
- **CD estimate**
  - Uses per-session files attributed to a Desktop account (M:1054-1069).
  - Otherwise `plan-usage-history.json` samples: infers the 5-hour start, and estimates the weekly reset from a 7-day cycle (M:1100-1170). Marked `~`.
- **CX:** finds the newest `rate_limits` line in `<CODEX_HOME>/sessions/**/*.jsonl` (M:1277-1319).
- **Exact usage (opt-in):**
  - Reads the Keychain item `Claude Code-credentials[-sha8(configDir)]`.
  - Calls `api.anthropic.com/api/oauth/usage` and `/profile`, at most once a minute per account.
  - Renews expired tokens through `console.anthropic.com/v1/oauth/token` and writes them back to the Keychain (E:1-238, M:860-891).
- **"Get exact usage" for CD:** a hidden CC login under `~/.accountdeck/exact/<id>` (M:304-318).
- **Merging:** the newest reading wins. Accounts on the same Claude account share one reading; estimates are ranked 10 min behind (M:997-1019).
- **Live refresh:** FSEvents on the status, session and history paths, debounced 0.4 s. Also a 15 s timer while visible and a 60 s timer (M:913-968).
- **Display:** a usage ring with countdown (M:1337-1412), turning orange at 60% and red at 85%. LimitCard and meter bars in the Dashboard.

## 3. Chats / sessions

- **CC chat index:** `<cfg>/projects/*/*.jsonl`, newest 400.
  - Title comes from custom-title, then ai-title, then the Desktop title, then the first prompt.
  - Grouped by cwd (D:178-273).
- **CD chat index:** `claude-code-sessions/<uuid>/<org>/local_*.json` (D:250-267).
- **Chats tab:** search, pick chats or whole folders, send them to another account (D:1334-1494).
- **Copy CC chats:** copies the `.jsonl` and its side folder, never overwriting. Then "Open as <dest>" → `claude --resume <sid>` (D:277-295, 1487-1493).
- **Copy CD chats:** copies into the destination's newest org (D:299-319).
- **Chat sync on CD switch** (default on, S:24-101):
  - The newest copy of each chat wins across accounts, and deletions spread.
  - Backups go to `chat-lists-backup/` and `moved-chats/`.

## 4. Per-account config

- **Environment cards** (D:448-538):
  - **CC:** email and org, model, permissions, MCP servers, plugins, skills, hooks, CLAUDE.md, env names only, status line.
  - **CX:** model, MCP servers, session count.
  - **CD:** login, MCP servers, sync state.
- **Send setup to another CC account** (D:1051-1123):
  - Model overwrites the destination's.
  - Permissions, plugins, hooks, env and MCP are merged.
  - Skills and CLAUDE.md are copied only if missing.
  - Every write leaves a dated backup.
- **MCP panel:** user, project and Desktop scopes. Sends missing servers to another account (D:351-396, 1143-1269).
- No in-app editor; copying is the only change it makes.

## 5. Menu bar panel

- Template mascot icon.
- Header shows account count, the active Desktop account, and a warning if the shell isn't linked.
- One section per service, in the chosen order.
- **Rows:** avatar, detail and usage badge. Hover shows Use/Switch; the context menu has sign in, rename, Finder and remove (M:1472-1575).
- **In-panel cards:** confirm and rename cards and toasts (NSAlert is unreliable in menu panels).
- **Animation:** staggered entrance when the panel opens (M:2150-2173).

## 6. Dashboard window

- **Window:** 1000×680. It shows a Dock icon only while open, and stays hidden when launched at login (D:21-99).
- **Sidebar:**
  - Accounts grouped by service.
  - Connect Terminal card.
  - Quick tiles: Terminal, Sync Chats, At Login, Data folder.
- **Home:**
  - Greeting.
  - Stats strip: accounts, chats, MCP servers, skills.
  - Setup notices.
  - Per-service cards with %, reset time and meters (H:80-181).
- **Account page:**
  - Hero section.
  - Overview and Chats tabs.
  - Usage card.
  - Environment and MCP panels (D:675-839).

## 7. Customize

- Show, hide and reorder services.
- Compact rows.
- Usage on rows.
- Limit to show: auto, 5-hour or weekly.
- Exact usage toggle with live status.
- Reset layout (M:1875-2022).

## 8. System integration

- **zsh hook:** marker block in `~/.zshrc`, precmd sources env.sh (M:191-211). zsh only.
- **Status-line hook:** in each CC account's `settings.json`.
- **Login item:** `SMAppService`.
- **Terminal:** launched through `.command` files; no AppleScript permission needed.
- **Notifications:** none on Mac, only in-panel toasts. Windows uses Electron `Notification`.

## 9. Privacy & safety

- **Local only,** except Exact usage, which talks to Anthropic.
- **Hidden values:** env and MCP values are never shown, only their names.
- **Backups before changes:**
  - Dated backups before every JSON write.
  - One-time backups of `.zshrc`, `settings.json`, the original Desktop login and the chat lists.
  - Removing an account moves it to the Trash.
- **Overclaim:** in-app text and `make-dmg.sh` say logins are "never read", which is false once Exact usage is on (it reads, sends and rewrites OAuth tokens). The README itself is accurate.

## 10. Build & packaging

- **Mac:**
  - `build.sh` runs `swiftc` for both architectures, then `lipo`, an inline Info.plist and an ad-hoc signature, and installs to `~/Applications`.
  - `make-dmg.sh` produces an unnotarized DMG.
  - `snapshots/shoot.sh` renders README screenshots against a demo home folder.
- **Windows:** Electron 33 with electron-builder NSIS (x64 and arm64). `npm test` runs a smoke test against a fake profile.

## 11. Windows build: differences

- **Switching:**
  - Sets user env vars through PowerShell, with no shell hook, so only new terminals pick up a switch (W/core/win.js:31-40).
  - CD: handles `Network\Cookies` and the MSIX install path, and force-stops Claude after about 4 s.
- **Missing:**
  - Exact usage.
  - CC-follows-CD.
  - ChatSync (it moves only the last chat).
- **Extra:**
  - Resume button on every CC chat.
  - Dedicated MCP page.
  - Native tray menu.
  - System notifications.
  - Single-instance lock.
  - Settings stored in `~/.accountdeck/settings.json`.
- **Drift from the Mac logic:**
  - Codex picks its newest file by name instead of mtime.
  - The `resets_in_seconds` base differs.
  - The second false-zero rule is missing.

## A. Storage layout

- **`~/.accountdeck/`:**
  - `state.json`, `env.sh`, `claude-status.sh`, `run/`.
  - Account folders: `claude/<id>/` (a CC config dir), `codex/<id>/`, `desktop/<id>/` (saved login), `chatgpt/<id>/` (browser profile).
  - `exact/<id>/`, `chat-lists-backup/`, `moved-chats/`.
- **Touched elsewhere:**
  - `~/.zshrc`.
  - `~/.claude.json` and `<cfg>/.claude.json`, `<cfg>/settings.json`, `<cfg>/projects/**`.
  - `~/.codex/**`.
  - `~/Library/Application Support/Claude/{Cookies, config.json, claude-code-sessions, plan-usage-history.json, claude_desktop_config.json}`.
  - Keychain items `Claude Code-credentials[-sha8]`.
- **Preferences** (`local.accountdeck`): `carryChat`, `menuServiceOrder`, `menuHiddenServices`, `menuCompactRows`, `menuUsageOnRows`, `menuLimitWindow`, `addPreset`, `exactUsage{On,Asked,Status}`.

## B. Rough edges worth fixing in switch-man

1. **Token-refresh race:** Exact usage can spend Claude Code's refresh token while Claude Code is also refreshing it, which can log Claude Code out (E:155-186). switch-man should only read tokens, never renew them.
2. **Stale exact readings stick:** the cache never expires, and the "already reset" filter isn't applied to exact readings (M:856, 1005).
3. **Keychain re-prompts:** an ad-hoc signature changes on every build, so the Keychain asks again after each update.
4. **`.zshrc` handling:** the write replaces a symlinked `.zshrc`, works for zsh only, and ignores `$ZDOTDIR` (M:124, 208).
5. **Shell quoting:** account names go into shell scripts without escaping (M:311, 327, 628).
6. **Desktop switching:**
   - No rollback if a Desktop swap fails midway (M:449-453).
   - On Mac only top-level `Cookies` is swapped.
7. **Weak status checks:** "Signed in" for Desktop and ChatGPT only means a file exists.
8. **Unsafe writes while running:** JSON and chat writes happen while Claude may be running, and backups pile up with no cleanup.
9. **"Turn On" banner sticks:** it never clears if any account has its own status line (M:995, 1020).
10. **Orphans on remove:** removing an account leaves its Keychain item and `exact/<id>` behind.
11. **Silent failures:** errors are swallowed almost everywhere (`try?`).
12. **Heavy rescans:** every Desktop chat write triggers a full scan, up to 4,000 Codex files.

## C. Groundwork for the new features

- **Reset notifications:**
  - `resetsAt` is known per account and window.
  - Dedupe by Claude account uuid.
  - A reset produces no file event, so a timer has to fire when `now` passes `resetsAt`.
  - Desktop estimates are approximate.
- **Usage stats:**
  - Nothing is kept today.
  - Existing sources to backfill from:
    - Desktop `plan-usage-history.json` samples.
    - Codex session logs, which repeat `rate_limits` with timestamps.
    - CC transcripts, which carry per-message token usage.
  - Exact readings arrive once a minute.
- **Ongoing agents:**
  - Per-session status files (`session_id`, cwd, `transcript_path`, model).
  - Desktop session ownership (`local_*.json`).
  - Codex `sessions/**/rollout-*.jsonl`.
  - No liveness check exists yet; use process listing or Claude Code `SessionStart`/`Stop` hooks.
  - Sending is only possible as `claude --resume <sid>` / `-p`, a new process on the same session. A live TTY session can't be typed into without AppleScript or tmux.
