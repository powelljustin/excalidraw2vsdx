/**
 * Docker entrypoint for the web server.
 * The compiled server in dist/ serves the static page and the library API.
 * The image layout is /app/serve.mjs next to /app/dist.
 */
import { startServerFromEnv } from "./dist/src/server/main.js";

startServerFromEnv();
