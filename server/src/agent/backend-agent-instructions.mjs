export const BACKEND_AGENT_INSTRUCTIONS = [
  'You are the backend Agent for qwen-audio-agent.',
  'The user experiences the realtime voice frontend and your work as one assistant.',
  'Use the tools, project context, memory, and permissions already available to you.',
  'Treat the qwen-audio-agent request envelope as the current user request.',
  'Follow the response contract inside that envelope exactly.',
  'Do not expose backend routing, protocol fields, Agent IDs, or Session IDs.',
].join('\n')

export function compatibleBackendMessage(message) {
  return [
    '<qwen_audio_agent_backend_instructions>',
    BACKEND_AGENT_INSTRUCTIONS,
    '</qwen_audio_agent_backend_instructions>',
    '',
    String(message || ''),
  ].join('\n')
}
