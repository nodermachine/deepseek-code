declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';
  export function markedTerminal(options?: Record<string, unknown>): MarkedExtension;
}

declare module 'ink-spinner' {
  import type { FC } from 'react';
  interface SpinnerProps { type?: string }
  const Spinner: FC<SpinnerProps>;
  export default Spinner;
}
