type SseResponse = {
  write(chunk: string): unknown;
  end(): unknown;
};

export function writeSseSafely(response: SseResponse, chunks: string[], end = false): boolean {
  try {
    for (const chunk of chunks) response.write(chunk);
    if (end) response.end();
    return true;
  } catch {
    return false;
  }
}
