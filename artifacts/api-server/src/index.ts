import app from "./app";
import { bot, startBot } from "./bot";
import { logger } from "./lib/logger";

// Telegram webhook endpoint (used in production)
app.post("/api/telegram-webhook", (req, res) => {
  bot.handleUpdate(req.body, res).catch((err) => {
    logger.error({ err }, "Webhook handler error");
    if (!res.headersSent) res.sendStatus(500);
  });
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

startBot().catch((err) => {
  logger.error({ err }, "Telegram bot failed to start");
});
