import { configureAudioWorklet } from "@banger/engine";

// Serve the trusted processor as a same-origin asset under the existing CSP.
configureAudioWorklet("/banger-sidechain.js");
