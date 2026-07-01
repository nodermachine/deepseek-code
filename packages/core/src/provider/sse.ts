import { createParser } from 'eventsource-parser';
import type { EventSourceMessage } from 'eventsource-parser';

export async function* parseSSEStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: string[] = [];
  const parser = createParser({
    onEvent(ev: EventSourceMessage) { if (ev.data !== undefined) queue.push(ev.data); },
  });

  // 如果 signal 已中止，直接跳过读取
  if (signal?.aborted) return;

  while (true) {
    const readPromise = reader.read();
    const result = signal
      ? await Promise.race([
          readPromise,
          new Promise<never>((_, reject) => {
            if (signal.aborted) return reject(new DOMException('Aborted', 'ABORT_ERR'));
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'ABORT_ERR')), { once: true });
          }),
        ])
      : await readPromise;

    const { value, done } = result;
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    while (queue.length) yield queue.shift()!;
  }
  while (queue.length) yield queue.shift()!;
}
