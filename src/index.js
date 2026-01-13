import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";

import { chatCompletionsHandler } from "./routes/chatCompletions.js";
import { healthHandler } from "./routes/health.js";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));


app.get("/", (req, res) => {
  res.json({
    name: "Company AI Gateway",
    description: "Unified API gateway for AI model providers.",
    endpoints: [
      { method: "GET", path: "/health", description: "Health check" },
      { method: "POST", path: "/v1/chat/completions", description: "Chat completions endpoint" }
    ]
  });
});

app.get("/health", healthHandler);
app.post("/v1/chat/completions", chatCompletionsHandler);

const port = parseInt(process.env.PORT || "8000", 10);
app.listen(port, () => {
  console.log(`AI Gateway listening on :${port}`);
});
