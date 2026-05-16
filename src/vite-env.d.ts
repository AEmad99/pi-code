/// <reference types="vite/client" />

import type { PiCodeApi } from "../electron/shared";

declare global {
  interface Window {
    piCode: PiCodeApi;
  }
}
