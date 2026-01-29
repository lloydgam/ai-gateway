import express from "express";

import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";
import corsMiddleware from "./lib/cors.js";



import { chatCompletionsHandler } from "./routes/chatCompletions.js";
import { healthHandler } from "./routes/health.js";
import userApiKeysRouter from "./routes/userApiKeys.js";
import claudeCompletionsRouter from "./routes/claudeCompletions.js";


const app = express();

// Open up CORS for all origins
app.use(corsMiddleware);
// Explicitly handle OPTIONS for all routes to ensure CORS preflight success
app.options('*', corsMiddleware);
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

// Claude v1/messages endpoint
app.use("/v1", claudeCompletionsRouter);

// User API Key management endpoints
app.use("/v1/user-api-keys", userApiKeysRouter);

// Opencode Support
app.use("/", claudeCompletionsRouter); // This will handle /messages

const port = parseInt(process.env.PORT || "8000", 10);
app.listen(port, () => {
  console.log(`AI Gateway listening on :${port}`);
});
