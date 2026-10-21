import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_URL = (
  process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
).replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

const runFile = promisify(execFile);

// Run npm run dev from the backend directory.
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const FOOTAGE_DIR = path.join(ROOT, 'assets', 'stock-footage');
const OUTPUT_DIR = path.join(ROOT, 'assets', 'outputs');

app.use(
  helmet({
    // Allows the dashboard's existing inline JavaScript in local development.
    contentSecurityPolicy: false
  })
);

app.use(cors({
  origin: [
    'http://localhost:4200',
    'http://127.0.0.1:4200'
  ]
}));

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Serve dashboard files.
app.use(express.static(PUBLIC_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), error => {
    if (error && !res.headersSent) {
      res.status(500).send(
        'Dashboard not found. Check that backend/public/index.html exists.'
      );
    }
  });
});

// Basic backend health.
app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  res.json({
    success: true,
    status: 'ok',
    service: 'reelexpert-backend',
    timestamp: new Date().toISOString()
  });
});

async function checkCommand(command: string, args: string[]) {
  try {
    const result = await runFile(command, args, { timeout: 5000 });

    return {
      online: true,
      version: (result.stdout || result.stderr || 'Available')
        .split('\n')[0]
        .trim()
    };
  } catch {
    return {
      online: false,
      version: ''
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

// Check whether a directory contains at least one file.
async function directoryHasFiles(directory: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directory);
    return entries.length > 0;
  } catch {
    return false;
  }
}

// Dashboard service status.
app.get('/api/status', async (_req, res) => {
  try {
    const [
      nodeCheck,
      ffmpegCheck,
      ollamaResult,
      footageExists,
      footageHasFiles,
      outputExists
    ] = await Promise.all([
      checkCommand(process.execPath, ['--version']),
      checkCommand('ffmpeg', ['-version']),

      fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(3000)
      })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Ollama returned HTTP ${response.status}`);
          }

          return await response.json() as {
            models?: Array<{ name: string }>;
          };
        })
        .catch(() => null),

      directoryExists(FOOTAGE_DIR),
      directoryHasFiles(FOOTAGE_DIR),
      directoryExists(OUTPUT_DIR)
    ]);

    const models = ollamaResult?.models ?? [];

    // Supports names such as qwen3:8b and qwen3:8b-instruct.
    const requestedModel = OLLAMA_MODEL.toLowerCase();

    const qwenInstalled = models.some(model => {
      const installedName = model.name.toLowerCase();

      return (
        installedName === requestedModel ||
        installedName.startsWith(`${requestedModel}-`)
      );
    });

    const ollamaOnline = ollamaResult !== null;

    const services = {
      backend: {
        name: 'Express Backend',
        description: 'ReelExpert API server',
        status: 'online',
        healthCheck: 'passed',
        url: `http://localhost:${PORT}`,
        version: process.version
      },

      node: {
        name: 'Node.js',
        description: 'JavaScript runtime',
        status: nodeCheck.online ? 'online' : 'offline',
        healthCheck: nodeCheck.online ? 'passed' : 'failed',
        version: nodeCheck.version
      },

      ollama: {
        name: 'Ollama',
        description: 'Local AI inference server',
        status: ollamaOnline ? 'online' : 'offline',
        healthCheck: ollamaOnline ? 'passed' : 'failed',
        url: OLLAMA_URL,
        message: ollamaOnline
          ? 'Ollama API is reachable'
          : 'Ollama is not responding'
      },

      qwen3: {
        name: 'Qwen3 Model',
        description: 'Local AI script generation',
        status: qwenInstalled ? 'online' : 'offline',
        healthCheck: qwenInstalled ? 'passed' : 'failed',
        model: OLLAMA_MODEL,
        models: models.map(model => model.name),
        qwen3Installed: qwenInstalled,
        message: qwenInstalled
          ? 'Model is installed'
          : ollamaOnline
            ? 'Model not found. Run: ollama pull ' + OLLAMA_MODEL
            : 'Cannot check model because Ollama is offline'
      },

      ffmpeg: {
        name: 'FFmpeg',
        description: 'Video encoding and rendering',
        status: ffmpegCheck.online ? 'online' : 'offline',
        healthCheck: ffmpegCheck.online ? 'passed' : 'failed',
        version: ffmpegCheck.version,
        message: ffmpegCheck.online
          ? 'Ready for video rendering'
          : 'Install with: brew install ffmpeg'
      },

      footage: {
        name: 'Stock Footage',
        description: 'Source video clips',
        status: footageExists ? 'online' : 'offline',
        healthCheck: footageExists ? 'passed' : 'failed',
        path: FOOTAGE_DIR,
        message: !footageExists
          ? 'Stock footage directory is missing'
          : footageHasFiles
            ? 'Footage directory contains files'
            : 'Directory exists but is empty'
      },

      output: {
        name: 'Video Output',
        description: 'Rendered MP4 storage',
        status: outputExists ? 'online' : 'offline',
        healthCheck: outputExists ? 'passed' : 'failed',
        path: OUTPUT_DIR,
        message: outputExists
          ? 'Output directory is ready'
          : 'Create the output directory'
      },

      tts: {
        name: 'Text-to-Speech',
        description: 'Narration audio generation',
        status: 'offline',
        healthCheck: 'failed',
        message: 'Not integrated yet'
      },

      renderer: {
        name: 'Video Renderer',
        description: 'Video, narration and subtitle composition',
        status: 'offline',
        healthCheck: 'failed',
        message: 'Rendering endpoint not implemented yet'
      }
    };

    res.setHeader('Cache-Control', 'no-store');

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      services
    });
  } catch (error) {
    console.error('Status check failed:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to check service status'
    });
  }
});

// AI script generation. Keeps the existing endpoint and response structure.
app.post('/api/scripts', async (req, res) => {
  const {
    topic,
    language = 'English',
    duration = 30,
    style = 'Cinematic'
  } = req.body ?? {};

  if (typeof topic !== 'string' || !topic.trim()) {
    res.status(400).json({
      success: false,
      error: 'Please enter a video topic.'
    });
    return;
  }

  if (topic.length > 500) {
    res.status(400).json({
      success: false,
      error: 'Topic must be 500 characters or fewer.'
    });
    return;
  }

  const durationSeconds = Number(duration);

  if (![15, 30, 60].includes(durationSeconds)) {
    res.status(400).json({
      success: false,
      error: 'Duration must be 15, 30, or 60 seconds.'
    });
    return;
  }

  const prompt = `
Create a short-form video plan.

Topic: ${topic.trim()}
Language: ${String(language).slice(0, 40)}
Duration: ${durationSeconds} seconds
Style: ${String(style).slice(0, 40)}

Return only valid JSON in this structure:
{
  "title": "video title",
  "hook": "attention-grabbing opening",
  "scenes": [
    {
      "duration": 5,
      "visual": "visual footage description",
      "narration": "spoken narration",
      "caption": "short on-screen caption"
    }
  ],
  "ending": "closing line"
}

Create enough scenes to approximately match the requested duration.
Keep narration concise and avoid fabricated facts.
`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.7
        }
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      res.status(502).json({
        success: false,
        error: `Ollama returned HTTP ${response.status}`
      });
      return;
    }

    const result = await response.json() as {
      response?: string;
      model?: string;
    };

    if (!result.response) {
      res.status(502).json({
        success: false,
        error: 'Ollama returned an empty response.'
      });
      return;
    }

    let script: unknown;

    try {
      script = JSON.parse(result.response);
    } catch {
      res.status(502).json({
        success: false,
        error: 'Ollama returned invalid JSON. Please try again.'
      });
      return;
    }

    res.json({
      success: true,
      model: result.model || OLLAMA_MODEL,
      script
    });
  } catch (error) {
    console.error('Script generation failed:', error);

    res.status(503).json({
      success: false,
      error: 'Cannot reach Ollama. Check that it is running and try again.'
    });
  }
});

// Return JSON for unknown API routes.
app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found.'
  });
});

app.listen(PORT, () => {
  console.log(`ReelExpert backend: http://localhost:${PORT}`);
  console.log(`Dashboard:          http://localhost:${PORT}/`);
  console.log(`Service status:     http://localhost:${PORT}/api/status`);
  console.log(`Health check:       http://localhost:${PORT}/api/health`);
  console.log(`Script API:         http://localhost:${PORT}/api/scripts`);
});