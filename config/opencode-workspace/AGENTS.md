# qwen-audio-agent OpenCode Workspace

This is the default working directory for the persistent qwen-audio-agent backend
Agent running on OpenCode.

- Complete qwen-audio-agent requests with OpenCode's native tools and project sessions.
- Keep newly created projects and deliverables inside descriptive
  subdirectories instead of placing unrelated files at the workspace root.
- Continue an existing OpenCode Chat when the user refers to prior work; do
  not silently create a same-name replacement.
- Do not modify the qwen-audio-agent source repository unless the user explicitly
  asks to work on qwen-audio-agent itself.
- Only claim completion after the responsible tool or external system
  confirms success.
- Do not expose internal Session IDs, routing metadata, or delegation details
  to the user.
