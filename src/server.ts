import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(
  /\/+$/,
  "",
);

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const runFile = promisify(execFile);

// Run npm run dev from the backend directory.
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const FOOTAGE_DIR = path.join(ROOT, "assets", "stock-footage");
const OUTPUT_DIR = path.join(ROOT, "assets", "outputs");

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: ["http://localhost:4200", "http://127.0.0.1:4200"],
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Static assets
app.use(
  "/assets",
  express.static(path.join(ROOT, "assets"), {
    fallthrough: false,
    immutable: false,
    maxAge: 0,
  }),
);

app.use(express.static(PUBLIC_DIR));

// Dashboard
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"), (error) => {
    if (error && !res.headersSent) {
      res
        .status(500)
        .send(
          "Dashboard not found. Check that backend/public/index.html exists.",
        );
    }
  });
});

// Basic backend health
app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.json({
    success: true,
    status: "ok",
    service: "reelexpert-backend",
    timestamp: new Date().toISOString(),
  });
});

async function checkCommand(command: string, args: string[]) {
  try {
    const result = await runFile(command, args, {
      timeout: 5000,
    });

    return {
      online: true,
      version: (result.stdout || result.stderr || "Available")
        .split("\n")[0]
        .trim(),
    };
  } catch {
    return {
      online: false,
      version: "",
    };
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function directoryHasFiles(directory: string): Promise<boolean> {
  try {
    return (await fs.readdir(directory)).length > 0;
  } catch {
    return false;
  }
}

// Dashboard service status
app.get("/api/status", async (_req, res) => {
  try {
    const [
      nodeCheck,
      ffmpegCheck,
      ollamaResult,
      footageExists,
      footageHasFiles,
      outputExists,
    ] = await Promise.all([
      checkCommand(process.execPath, ["--version"]),
      checkCommand("ffmpeg", ["-version"]),
      fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Ollama returned HTTP ${response.status}`);
          }

          return (await response.json()) as {
            models?: Array<{ name: string }>;
          };
        })
        .catch(() => null),
      directoryExists(FOOTAGE_DIR),
      directoryHasFiles(FOOTAGE_DIR),
      directoryExists(OUTPUT_DIR),
    ]);

    const models = ollamaResult?.models ?? [];
    const requestedModel = OLLAMA_MODEL.toLowerCase();

    const qwenInstalled = models.some((model) => {
      const installedName = model.name.toLowerCase();

      return (
        installedName === requestedModel ||
        installedName.startsWith(`${requestedModel}-`)
      );
    });

    const ollamaOnline = ollamaResult !== null;

    const services = {
      backend: {
        name: "Express Backend",
        description: "ReelExpert API server",
        status: "online",
        healthCheck: "passed",
        url: `http://localhost:${PORT}`,
        version: process.version,
      },

      node: {
        name: "Node.js",
        description: "JavaScript runtime",
        status: nodeCheck.online ? "online" : "offline",
        healthCheck: nodeCheck.online ? "passed" : "failed",
        version: nodeCheck.version,
      },

      ollama: {
        name: "Ollama",
        description: "Local AI inference server",
        status: ollamaOnline ? "online" : "offline",
        healthCheck: ollamaOnline ? "passed" : "failed",
        url: OLLAMA_URL,
        message: ollamaOnline
          ? "Ollama API is reachable"
          : "Ollama is not responding",
      },

      qwen3: {
        name: "Qwen3 Model",
        description: "Local AI script generation",
        status: qwenInstalled ? "online" : "offline",
        healthCheck: qwenInstalled ? "passed" : "failed",
        model: OLLAMA_MODEL,
        models: models.map((model) => model.name),
        qwen3Installed: qwenInstalled,
        message: qwenInstalled
          ? "Model is installed"
          : ollamaOnline
            ? `Model not found. Run: ollama pull ${OLLAMA_MODEL}`
            : "Cannot check model because Ollama is offline",
      },

      ffmpeg: {
        name: "FFmpeg",
        description: "Video encoding and rendering",
        status: ffmpegCheck.online ? "online" : "offline",
        healthCheck: ffmpegCheck.online ? "passed" : "failed",
        version: ffmpegCheck.version,
        message: ffmpegCheck.online
          ? "Ready for video rendering"
          : "Install with: brew install ffmpeg",
      },

      footage: {
        name: "Stock Footage",
        description: "Source video clips",
        status: footageExists ? "online" : "offline",
        healthCheck: footageExists ? "passed" : "failed",
        path: FOOTAGE_DIR,
        message: !footageExists
          ? "Stock footage directory is missing"
          : footageHasFiles
            ? "Footage directory contains files"
            : "Directory exists but is empty",
      },

      output: {
        name: "Video Output",
        description: "Rendered MP4 storage",
        status: outputExists ? "online" : "offline",
        healthCheck: outputExists ? "passed" : "failed",
        path: OUTPUT_DIR,
        message: outputExists
          ? "Output directory is ready"
          : "Create the output directory",
      },

      tts: {
        name: "Text-to-Speech",
        description: "Narration audio generation",
        status: "offline",
        healthCheck: "failed",
        message: "Not integrated yet",
      },

      renderer: {
        name: "Video Renderer",
        description: "Video, narration and subtitle composition",
        status: "offline",
        healthCheck: "failed",
        message: "Rendering endpoint not implemented yet",
      },
    };

    res.setHeader("Cache-Control", "no-store");

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      services,
    });
  } catch (error) {
    console.error("Status check failed:", error);

    res.status(500).json({
      success: false,
      error: "Unable to check service status",
    });
  }
});

// AI reel script generation
app.post("/api/scripts", async (req, res) => {
  try {
    const {
      topic,
      audience = "General audience",
      platform = "Instagram Reels",
      language = "English",
      duration = 30,
      style = "Engaging",
    } = req.body ?? {};

    if (typeof topic !== "string" || !topic.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please provide a topic for your reel.",
      });
    }

    const allowedDurations = [15, 30, 45, 60, 90];

    if (
      !allowedDurations.includes(Number(duration)) ||
      typeof audience !== "string" ||
      typeof platform !== "string" ||
      typeof language !== "string" ||
      typeof style !== "string" ||
      [audience, platform, language, style].some(
        (value) => value.length > 100,
      ) ||
      topic.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid reel settings.",
      });
    }

    const targetDuration = Number(duration);

    const prompt = `
Create a high-quality short-form video script.

Topic: ${topic.trim()}
Target audience: ${audience}
Platform: ${platform}
Language: ${language}
Target duration: ${targetDuration} seconds
Style: ${style}

Return ONLY valid JSON in this exact structure:
{
  "title": "Short reel title",
  "hook": "Attention-grabbing opening line",
  "script": "Complete narration script",
  "voiceover": "Narration text ready for text-to-speech",
  "captions": ["Caption line 1", "Caption line 2"],
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 5,
      "visual": "Detailed visual description",
      "narration": "Words spoken in this scene",
      "onScreenText": "Short text overlay"
    }
  ],
  "hashtags": ["#example"]
}

Requirements:
- Write naturally for the selected audience and language.
- Make the hook compelling within the first 3 seconds.
- Divide the video into scenes that fit the target duration.
- Ensure scene durations add up to approximately ${targetDuration} seconds.
- Keep on-screen text short and readable.
- Use practical visual descriptions suitable for a video editor.
- Include all required fields.
- Do not include markdown fences or explanatory text.
`;

    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are ReelExpert AI. Return a complete, valid JSON object only. Do not escape the JSON object itself.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        format: "json",
        stream: false,
        think: false,
        options: {
          temperature: 0.3,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const details = await ollamaResponse.text();

      console.error("Ollama error:", details);

      return res.status(502).json({
        success: false,
        message:
          "AI generation failed. Check that Ollama is running and the model is available.",
      });
    }

    const ollamaData = (await ollamaResponse.json()) as {
      message?: {
        content?: string;
      };
    };

    const content = ollamaData.message?.content;

    if (!content) {
      throw new Error("Ollama returned an empty response.");
    }

    let reel: any;

    try {
      reel = JSON.parse(content);
    } catch (parseError) {
      console.error("Invalid JSON returned by Ollama:", content.slice(0, 1500));

      throw new Error(
        `Ollama returned invalid JSON: ${
          parseError instanceof Error ? parseError.message : String(parseError)
        }`,
      );
    }

    if (
      typeof reel.title !== "string" ||
      typeof reel.hook !== "string" ||
      typeof reel.script !== "string" ||
      typeof reel.voiceover !== "string" ||
      !Array.isArray(reel.scenes) ||
      reel.scenes.length === 0
    ) {
      throw new Error("The generated reel has an invalid structure.");
    }

    return res.json({
      success: true,
      reel: {
        ...reel,
        settings: {
          topic: topic.trim(),
          audience,
          platform,
          language,
          duration: targetDuration,
          style,
        },
        status: "script_ready",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error("Reel generation error:", error);

    const timedOut = error instanceof Error && error.name === "TimeoutError";

    return res.status(timedOut ? 504 : 500).json({
      success: false,
      message: timedOut
        ? "AI generation timed out. Please try again."
        : "Unable to generate the reel script. Please check your Ollama setup.",
    });
  }
});

// IMPORTANT: Keep this AFTER every API route.
app.use("/api", (_req, res) => {
  res.status(404).json({
    success: false,
    error: "API endpoint not found.",
  });
});

app.listen(PORT, () => {
  console.log(`ReelExpert backend: http://localhost:${PORT}`);
  console.log(`Dashboard:          http://localhost:${PORT}/`);
  console.log(`Service status:     http://localhost:${PORT}/api/status`);
  console.log(`Health check:       http://localhost:${PORT}/api/health`);
  console.log(`Script API:         http://localhost:${PORT}/api/scripts`);
});
