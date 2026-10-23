
import { Router } from 'express';
import path from 'node:path';

import {
  checkCommand,
  directoryExists,
  directoryHasFiles
} from '../utils/system-checks.js';

const router = Router();

const ROOT = process.cwd();
const FOOTAGE_DIR = path.join(ROOT, 'assets', 'stock-footage');
const OUTPUT_DIR = path.join(ROOT, 'assets', 'outputs');

const OLLAMA_URL = (
  process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
).replace(/\/+$/, '');

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

router.get('/status', async (_req, res) => {
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
            throw new Error(`Ollama HTTP ${response.status}`);
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
    const requestedModel = OLLAMA_MODEL.toLowerCase();

    const qwenInstalled = models.some(model => {
      const name = model.name.toLowerCase();

      return (
        name === requestedModel ||
        name.startsWith(`${requestedModel}-`)
      );
    });

    const ollamaOnline = ollamaResult !== null;

    res.setHeader('Cache-Control', 'no-store');

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      services: {
        backend: {
          name: 'Express Backend',
          description: 'ReelExpert API server',
          status: 'online',
          healthCheck: 'passed',
          url: `http://localhost:${process.env.PORT || 3000}`,
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
              ? `Model not found. Run: ollama pull ${OLLAMA_MODEL}`
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
      }
    });
  } catch (error) {
    console.error('Status check failed:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to check service status'
    });
  }
});

export default router;
