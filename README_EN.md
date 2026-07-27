# qwen-audio-agent

[中文](README.md) | [English](README_EN.md)

## Give Your Agent a Voice

**Talk freely without waiting for tasks, and connect seamlessly to the Agent you
already use.**

qwen-audio-agent is a realtime voice frontend for mainstream Agents. You can
keep talking as naturally as on a phone call, interrupt at any time, and use
your voice to delegate searches, file operations, coding, and other long-running
work. It connects different Agents through a unified Adapter architecture. The
project will continue adding mainstream Agents instead of binding the product
to one default backend.

It does not replace your backend Agent. Instead, it brings the Agent's existing
models, tools, MCP servers, Skills, permissions, and project context naturally
into a realtime voice conversation.

## Keep Talking While Work Continues

![qwen-audio-agent architecture](docs/architecture-overview-en.png)

The realtime frontend listens, understands, and responds. It answers questions
directly when it can, and delegates work to the backend Agent when external
information, tools, or longer processing is needed.

Backend execution does not block the voice conversation. You can continue with
new requests, ask for progress, change direction, or cancel a task. Completed
results return to the current context at an appropriate time, where the
realtime frontend presents them naturally. Throughout the entire interaction,
you are always talking to the same assistant.

## Agent Support

qwen-audio-agent aims to provide one realtime voice entry point for mainstream
Agents. Because native sessions, permissions, and process models differ, every
integration has an explicit Adapter rather than assuming one universal backend
interface.

| Agent | Status | Current integration |
| --- | --- | --- |
| OpenCode | Supported | Managed or compatible mode, coordinator Session, project tasks, events, cancellation, and permissions |
| OpenClaw | Supported | Managed or compatible mode, fixed coordinator Agent, task events, and permission relay |
| Qoder | Supported | Official SDK/CLI, native CLI Session discovery and resume, project delegation, and permissions |
| Codex | In development | Independent feature branch, merged after validation |
| Hermes | In development | Independent feature branch, merged after validation |
| More mainstream Agents | Expanding | Added incrementally through the shared Adapter contract |

"Supported" means the integration is present on the main branch. "In
development" means an independent feature branch exists, but the capability
must not yet be treated as released. Native limitations still apply; for
example, Qoder Desktop Quests cannot currently be resumed through the official
SDK.

## Core Experience

- Free-flowing conversation with full-duplex audio, natural interruption, and
  continuous multi-turn dialogue
- Voice conversation and delegated tasks proceed independently
- Results return seamlessly to the conversation for follow-up or further work
- Connect to your existing Agent tools, projects, memory, and workflows
- One voice entry point for multiple mainstream Agents, with an expanding Adapter ecosystem
- WebUI, terminal TUI, and a macOS desktop orb
- Local user profile and personal memory across sessions

## Installation

You need Node.js 22.22.2, 24.15.0, or a newer compatible version, npm 10+, and a
DashScope API Key. The repository includes `.nvmrc` and `.node-version`; if you
use nvm, run `nvm use`.

Install a published version from the npm registry:

```bash
npm install -g qwen-audio-agent
```

If the package has not yet been published to your current registry, or if you
want to use the repository version directly, build and install the same npm
artifact from source:

```bash
git clone https://github.com/QwenAudio/qwen-audio-agent.git
cd qwen-audio-agent
npm install
npm run install:global
```

`install:global` builds the WebUI, creates a temporary tarball, and installs
that tarball as a standalone global package. It does not symlink `qwenaudio` to
the source directory.

Upgrade the registry version:

```bash
npm install -g qwen-audio-agent@latest
```

Upgrade a source installation:

```bash
git pull
npm install
npm run install:global
```

## Quick Start

Create your user configuration:

```bash
qwenaudio config
```

Open the `config.env` file shown by the command and add:

```dotenv
DASHSCOPE_API_KEY=your-key
```

Start the Gateway:

```bash
qwenaudio
```

`qwenaudio`, `qwenaudio gateway`, and `qwenaudio gateway run` all run in the
foreground. Open another terminal and start the voice interface:

```bash
qwenaudio tui
```

On macOS, the minimal TUI uses CoreAudio echo cancellation for full-duplex
audio. It keeps listening while a response is playing and supports interruption
by speaking, but not manual interruption. Linux and Windows use the same minimal
interface with `sounddevice`/PortAudio in half-duplex mode: the microphone is
paused during playback, press `x` to interrupt manually, and recording resumes
automatically when playback ends. Before first use on a non-macOS system,
install `sounddevice` and make sure PortAudio is available on the system.

Linux and Windows can also explicitly enable full-duplex mode without echo
cancellation. In this mode, speaking can interrupt playback, while the `x` key
cannot. Wear headphones to prevent speaker output from causing false
transcriptions or interruptions:

```bash
qwenaudio tui --audio-mode full
```

Alternatively, open the WebUI:

```bash
qwenaudio webui
```

## macOS Desktop App

The desktop app is a persistent voice orb that connects to the same Gateway.
The desktop UI is bundled into the `.app`, so rebuilding the app is enough to
update its appearance. The Gateway only provides the API, realtime voice, and
backend Agent capabilities. Desktop settings manage only the Gateway connection
URL and local appearance. Realtime credentials, model, voice, and backend Agent
type, model, and permissions must be selected when configuring or launching the
Gateway; the settings window displays the active values as read-only status.
The orb starts with microphone input enabled and
joins the voice session only after the microphone is ready. It remains disabled
if permission is denied or initialization fails. Start the Gateway as described
above, download the `.dmg` from the releases page, open it, and drag
**Qwen Audio Agent** into Applications.

Build an unsigned package for local testing:

```bash
npm run desktop:build:local
```

After the build completes, open the `.dmg` in `dist/desktop/` and drag
**Qwen Audio Agent** into Applications. For local development, run
`npm run desktop`.

Formal releases use `npm run desktop:build`. This command requires an Apple
Developer ID signing identity and notarization credentials, enables the
hardened runtime, and grants only the minimum permissions needed for microphone
and network access. For signing, use `CSC_LINK`/`CSC_KEY_PASSWORD`, or
`CSC_NAME` for an identity installed in Keychain. For notarization, use
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; alternatively,
use `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`.

## Run the Gateway in the Background

To keep your personal assistant available, install the Gateway as a user
service:

```bash
qwenaudio gateway install
```

Common management commands:

```bash
qwenaudio gateway status
qwenaudio gateway restart
qwenaudio gateway stop
qwenaudio gateway start
qwenaudio gateway uninstall
```

macOS uses `launchd`, while Linux uses `systemd --user`. The Gateway and any
backend Agent it starts are managed together.

## Choose a Backend Agent

Select the Gateway backend with `AGENT_PROTOCOL`. For example, OpenCode:

```dotenv
AGENT_PROTOCOL=opencode
```

OpenClaw:

```dotenv
AGENT_PROTOCOL=openclaw
```

To use Qoder:

```dotenv
AGENT_PROTOCOL=qoder
QODER_MODEL=auto
```

The Qoder adapter reuses the local `qodercli` login and native Session store.
Its persistent coordinator can create a project Session or resume an existing
one, and delegated voice interactions are appended to that native Qoder CLI
history. Qoder Desktop Quests use a different record format that the official
SDK cannot currently list or resume, so these interactions do not appear in an
existing desktop Quest. Qoder uses its official SDK to manage CLI child
processes, requires no backend URL, and currently supports managed mode only.

Backend permissions default to `native`, leaving permission prompts to
Qoder/OpenCode. Users who explicitly accept unattended command execution and
file changes can set `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=full` before
startup. Full mode is available only for managed Qoder and OpenCode, not
compatible mode or OpenClaw.

Enhanced mode starts a dedicated backend Agent for qwen-audio-agent while
preserving your existing models, permissions, Skills, and MCP configuration.
Compatible mode can instead connect to an already-running OpenCode or OpenClaw
instance without modifying the existing service.

See the [configuration guide](docs/configuration.md) for details.

## User Profile and Memory

User data is stored in `~/.config/qwaudio/`:

- `USER.md`: your preferred name, location, preferences, and frequently used
  projects
- `frontend-memory.json`: information you explicitly ask the assistant to
  remember long term
- `tasks.json`: task results and pending notification state
- `workspaces/`: default OpenCode, OpenClaw, and Qoder working directories in enhanced
  mode
- `backends/`: mutable backend Agent state and managed configuration

These files are never written to the source repository. Do not store passwords,
API Keys, verification codes, or tokens in `USER.md`. Microphone audio and
realtime conversations are sent to the configured Qwen Audio Realtime service.
Delegated work may also be sent to models, tools, and MCP services configured by
the user. See the [privacy notice](PRIVACY.md) for detailed data boundaries.

## Development

```bash
npm install
npm run build
npm test
```

```bash
npm run dev       # Gateway and WebUI with hot reload
npm run desktop   # macOS desktop orb
```

By default, the Gateway accepts only `localhost`, `127.0.0.1`, and `::1` as
Host/Origin values. For remote access, place it behind an authenticated HTTPS
reverse proxy and explicitly trust the public proxy address with
`QWEN_AUDIO_AGENT_ALLOWED_ORIGINS`. Never expose the Gateway port directly to a
LAN or the public internet. See the
[configuration guide](docs/configuration.md) for details.

## Contributing and Security

- Development and contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security reports: [SECURITY.md](SECURITY.md)
- Data flow and privacy: [PRIVACY.md](PRIVACY.md)
- Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## License

[Apache License 2.0](LICENSE)
