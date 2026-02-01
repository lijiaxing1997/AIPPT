import { startServerFromEnv } from "./server.js";

startServerFromEnv().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

