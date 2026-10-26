/** Explicit one-shot command; never started by the image's default CMD. */
import { createStagingProviderRunner } from '../src/lib/channex-bookings/staging-runner.ts';
const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown.abort());
try {
  const run = createStagingProviderRunner(process.env);
  if (!run) throw Error();
  const result = await run(shutdown.signal);
  console.log(JSON.stringify({ event: 'airbnb-staging-rehearsal', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'airbnb-staging-rehearsal', outcome: 'incomplete', canSend: false }));
  process.exitCode = 1;
}
