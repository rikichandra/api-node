import { configFromEnv } from "./config.js";
import { buildApp } from "./app.js";
import { createMapsMatcher } from "../lib/maps-matcher.js";

let app;
try {
  const config = configFromEnv();
  config.onFatal = () => {
    const deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
    setImmediate(() => {
      void app?.close().finally(() => process.exit(1));
    });
  };
  const factory = (options) =>
    createMapsMatcher({ ...options, channel: config.browserChannel });
  // Fail startup if the configured browser is not installed or cannot launch.
  const preflight = await factory({});
  await preflight.close();
  app = await buildApp(config, factory);
  for (const event of ["SIGTERM", "SIGINT"])
    process.once(event, () => {
      const deadline = setTimeout(() => process.exit(1), 30000);
      deadline.unref();
      void app
        .close()
        .then(() => {
          clearTimeout(deadline);
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
  await app.listen({ host: config.host, port: config.port });
} catch (e) {
  console.error(
    `Startup failed (${e.code || e.name}): ${e.message.split("\n")[0]}`,
  );
  await app?.close();
  process.exitCode = 1;
}
