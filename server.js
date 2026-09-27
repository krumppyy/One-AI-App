import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize Gemini SDK if API key is present
const geminiApiKey = process.env.GEMINI_API_KEY;
let aiClient = null;
if (geminiApiKey) {
  try {
    aiClient = new GoogleGenAI({ apiKey: geminiApiKey });
  } catch (err) {
    console.warn("[Gemini API] Failed to initialize GoogleGenAI client:", err);
  }
}

// POST /api/generateText - Streaming AI text generator
app.post("/api/generateText", async (req, res) => {
  const { instruction, prompt, model = "gemini-2.5-flash", stopSequences } = req.body;
  const inputPrompt = instruction || prompt;

  if (!inputPrompt) {
    return res.status(400).json({ error: "Missing instruction or prompt" });
  }

  if (!aiClient) {
    // Fallback response if GEMINI_API_KEY is not configured
    return res.json({
      text: `AI response: ${inputPrompt.slice(0, 100)} (Please configure GEMINI_API_KEY for full AI capabilities)`
    });
  }

  try {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const responseStream = await aiClient.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: inputPrompt,
      config: stopSequences ? { stopSequences } : undefined,
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }
    res.end();
  } catch (error) {
    console.error("[generateText Error]:", error?.message || error);
    const fallbackText = `Enhanced prompt: ${inputPrompt.trim()}, cinematic lighting, hyper-detailed, continuous fluid motion, 8k resolution, masterpiece.`;
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(fallbackText);
    } else {
      res.write("\n" + fallbackText);
      res.end();
    }
  }
});

// GET /api/proxy - CORS bypass proxy for external APIs (Pollinations, Hugging Face, etc.)
app.all("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url || req.body?.url;
  if (!targetUrl) {
    return res.status(400).send("Missing target url parameter");
  }

  try {
    const fetchOptions = {
      method: req.method === "POST" ? "POST" : "GET",
      headers: {},
    };

    if (req.method === "POST" && req.body) {
      fetchOptions.headers["Content-Type"] = req.headers["content-type"] || "application/json";
      fetchOptions.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const upstream = await fetch(targetUrl, fetchOptions);
    res.status(upstream.status);

    for (const [key, val] of upstream.headers.entries()) {
      if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");

    const arrayBuffer = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("[Proxy Error]:", err);
    res.status(502).json({ error: "Proxy request failed: " + err.message });
  }
});

// Serve static assets
app.use(express.static(__dirname, {
  extensions: ["html", "htm"],
  index: "index.html",
}));

// Fallback to index.html for SPA routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`[AI Multimedia Toolkit] Server running on http://${HOST}:${PORT}`);
});
