import { loadConfig, startServer } from "./server.ts";

const config = loadConfig();
const { server, db } = startServer(config);

server.on("listening", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(`Personal data API listening on http://${config.host}:${port}`);
  console.log(`Database: ${config.dbPath}`);
});

server.on("error", (error) => {
  console.error(error.message);
  db.close();
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
