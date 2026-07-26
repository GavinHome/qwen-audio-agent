# qwen-audio-agent architecture

This document defines the product boundary. Changes that contradict these
invariants are architecture changes, not local feature work.

## 1. User-visible model

The user talks to one qwen-audio assistant. Internally there are two qwen-audio-agent
layers:

1. **Realtime frontend** — full-duplex speech, simple direct answers, and basic
   local time/memory tools.
2. **Backend Agent** — one persistent Agent Session that owns every request
   requiring tools, current information, files, applications, code, or
   multi-step work.

The backend may be OpenCode or OpenClaw. It may internally use tools, skills,
agents, or other Sessions. Those are adapter-private implementation details and
do not create additional qwen-audio-agent layers.

## 2. Nonblocking request flow

```text
final ASR
   │
   ├─ immediately answerable ───────────────► Realtime speech
   │
   └─ requires work
          │ spawn_thinking(objective)
          ▼
      Work accepted
          │ response returns to Realtime immediately
          ▼
      owner FIFO queue
          │
          ▼
      fixed Backend Agent Session
          │ the backend decides how to work
          ▼
      final presentation
          │ waits for a safe duplex insertion window
          ▼
      Realtime naturally speaks the result
```

`spawn_thinking` never waits for the requested work. The user can continue
speaking while multiple Work items are queued. For each owner, only one Work
item is sent into the Backend Agent Session at a time.

## 3. Realtime boundary

Realtime has exactly four tools:

```text
spawn_thinking
cancel_agent_task
get_current_time
user_memory
```

`user_memory` keeps one small protocol for frontend-owned memory:

- `recall` reads profile or long-term text records and returns stable IDs;
- `remember` adds a new durable fact;
- `replace` atomically replaces recalled IDs when the user corrects a fact;
- `forget` removes explicitly requested records.

Only the marked managed section of `USER.md` is editable. User-maintained profile
text outside that section is returned as read-only data and cannot be replaced.

It does not have tools for:

- selecting, creating, continuing, or cancelling backend Sessions;
- choosing synchronous, asynchronous, foreground, or background execution;
- querying qwen-audio-agent Work or selecting backend execution strategy;
- replying to backend permission prompts;
- selecting tools, Agents, or subagents.

The `objective` passed to `spawn_thinking` is a conservative interpretation of
the user's request, not an execution plan. Recent voice context is separately
included in the backend Agent envelope so references such as “continue that
page” remain understandable. Final ASR remains the source of truth.

## 4. Fixed Backend Agent Session

Each backend adapter owns its persistent Session identity. OpenCode uses:

```text
qwen-audio-agent:<owner>:backend
```

OpenClaw uses its equivalent Agent Session key:

```text
agent:<agent>:qwen-audio-agent:<owner>:backend
```

Voice browser session IDs and Work IDs never change that identity. A new voice
conversation therefore continues using the same backend Agent context.

Both the Gateway queue and the adapter serialize writes. This double guard
prevents concurrent messages from racing inside one backend Session.

The backend Agent owns its execution strategy. qwen-audio-agent supplies the user
request, recent voice context, local preferences, and a final response shape;
it does not instruct the backend Agent how to use backend-specific capabilities.

## 5. Work state

A qwen-audio-agent Work record is a delivery receipt, not a mirror of the backend's
internal task graph.

```text
queued → running → completed
   ↘ cancelled    ↘ failed
```

Public fields are limited to the user request, timestamps, final result/error,
generic tool activity, and notification state. There is no execution mode,
delivery mode, subagent state, permission state, backend topology, or
backend cancellation internals.

The UI presents both `queued` and `running` as the same “processing” state.
Queue position is an internal scheduling detail and does not change the user's
duplex conversation.

Queued and running Work cannot be safely resumed after a Gateway restart, so
they become failed with an explicit restart reason. Completed results and
notification delivery state are persisted.

## 6. Progress animation

Progress is observability, not control. Each adapter filters its backend event
stream into generic activity belonging to the fixed backend Agent Session:

- tool name, bounded user-safe detail, and running/completed state;
- text/reasoning activity represented only as “organizing result”.

The UI maps this to stable phrases such as “searching”, “reading”, “generating
an image”, or “organizing the result”. Session IDs, commands, subagent IDs,
permissions, and raw reasoning are not shown.

Activity never produces spoken status updates and never affects the queue.

## 7. Final result delivery

The backend Agent returns one final presentation:

```json
{
  "work_id": "work id",
  "state": "completed",
  "mode": "respond",
  "presentation": {
    "speech": "concise result material",
    "inline": null
  }
}
```

`speech` is semantic material, not a script. Realtime adapts it to the live
conversation. `inline` carries Markdown, code, or links for the shared
timeline.

Completed results prefer the originating conversation. On a fresh connection,
unfinished results from older conversations may be recovered for the same
owner. A renewable claim prevents two live frontends from presenting the same
result. Results are injected into Realtime context and marked delivered only
after playback finishes. If the user interrupts, is speaking, or another
response is pending, delivery waits and retries without duplicating context.
Retries are bounded so one malformed result cannot block later completions.

## 8. Backend-internal capabilities

The backend Agent may use native backend tools or Sessions to work in another
project or delegate internally. This is permitted because the choice happens
behind the backend Agent boundary.

Frontend code must not depend on which internal capability was chosen.
Internal completions must be collected by the backend Agent and returned through
its single final response contract.

## 9. Dependency direction

```text
Web / TUI
   ↓ WebSocket and HTTP
Realtime Gateway
   ↓ spawn_thinking
Work queue
   ↓
backend Agent envelope
   ↓
Backend adapter
   ↓
OpenCode Server or OpenClaw Gateway
```

Backend-specific API details belong only in `server/src/agent`. Realtime tools
must not import backend adapters. The UI consumes only public Work events and
final timeline content. Package-level `shared` modules are foundational runtime
utilities; server `core` may depend on them, but they must not depend on server
layers.

## 10. Process ownership

The Gateway is the only core service process. In managed mode it owns exactly
one OpenCode or OpenClaw backend process and stops that process when the Gateway
stops. In compatible mode it owns no backend process.

Desktop, TUI and WebUI are replaceable Gateway clients. They must never spawn,
restart or stop the Gateway or a backend. Closing a UI therefore cannot affect
queued work or the fixed backend Agent Session. Configuration that changes
Realtime or backend behavior takes effect on the next Gateway start; changing a
UI's Gateway URL only reconnects that UI.

## 11. Review checklist

Before merging a change, verify:

1. Can Realtime still converse while backend work is queued or running?
2. Does every executable request enter the same persistent backend Agent
   Session?
3. Did any frontend API gain knowledge of Session, subagent, permission, or
   execution mode?
4. Are tool events used only for generic UI progress?
5. Is completion spoken only from a final backend Agent result?
6. Did any UI begin managing a Gateway or backend process?
6. Can interruption postpone speech without cancelling submitted Work?
7. Do tests cover FIFO serialization, fixed Session reuse, tool animation, and
   delivery retry?
