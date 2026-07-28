export function desktopOrbClassName({
  state,
  enabled,
  error = false,
  dragging = false,
}) {
  return [
    'desktop-orb-stage',
    state,
    enabled ? 'enabled' : 'input-muted',
    error ? 'error' : '',
    dragging ? 'dragging' : '',
  ].filter(Boolean).join(' ')
}
