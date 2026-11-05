export type SseEvent = Record<string, unknown>;

export function parseSseChunk(
  buffer: string,
  chunk: string,
): { buffer: string; events: SseEvent[]; done: boolean } {
  const blocks = `${buffer}${chunk}`.replaceAll('\r\n', '\n').split('\n\n');
  const remaining = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  let done = false;

  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    events.push(JSON.parse(data) as SseEvent);
  }

  return { buffer: remaining, events, done };
}
