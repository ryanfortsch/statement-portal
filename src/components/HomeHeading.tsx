import type { ReactNode } from 'react';

/** The daily view gets a working heading; its assistant stays one tap away. */
export function HomeHeading({ children }: { children: ReactNode }) {
  return <section className="rt-home-heading max-w-[1100px] mx-auto px-10">
    <h1>Today</h1>
    <details className="rt-home-ask">
      <summary>Ask Helm</summary>
      <div className="rt-home-ask-body">{children}</div>
    </details>
  </section>;
}
