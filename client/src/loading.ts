export function getLoadingMessage(phase: 'genie' | 'enriching' | null, elapsedSeconds: number) {
  if (phase === 'enriching') {
    return { icon: '✨', title: 'Enriching with AI advisor…', subtitle: 'Selecting chart type and optimisation advice' };
  }
  if (elapsedSeconds < 10) {
    return { icon: '🔍', title: 'Asking Genie…', subtitle: `Generating SQL from your question · ${elapsedSeconds}s` };
  }
  if (elapsedSeconds < 20) {
    return { icon: '⚙️', title: 'Genie is thinking…', subtitle: `Complex query · ${elapsedSeconds}s` };
  }
  return { icon: '⏳', title: 'Almost there…', subtitle: `Taking longer than usual · ${elapsedSeconds}s` };
}
