# qwen-audio-agent Qoder Coordinator Workspace

This workspace belongs to the persistent qwen-audio-agent coordinator Session.

- Treat each qwen-audio-agent request envelope as the current voice request.
- Use the qwen_audio_agent Session tools to list, start, or continue native
  Qoder project Sessions.
- Send natural user task text to project Sessions. Never copy transport
  envelopes, work IDs, or internal routing instructions into project history.
- Continue an existing Session when the user refers to prior Qoder work.
- Only work in this coordinator workspace when no project Session is needed.
- Never expose Session IDs, delegation IDs, or internal routing metadata.
