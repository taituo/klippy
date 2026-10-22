// Standalone build of the eyes for CDP injection (Playwright / headless / VPS / workers)
// and for tests. Exposes everything on globalThis.__klippyEyes.
import * as eyes from './index';

declare global {
  // eslint-disable-next-line no-var
  var __klippyEyes: typeof eyes;
}

globalThis.__klippyEyes = eyes;
