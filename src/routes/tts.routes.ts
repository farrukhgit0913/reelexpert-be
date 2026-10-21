import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

const router = Router();
const execFileAsync = promisify(execFile);

const OUTPUT_DIR = path.resolve(
  process.cwd(),
  'assets',
  'outputs'
);

const ALLOWED_VOICES = new Set([
  'Samantha',
  'Alex',
  'Victoria',
  'Daniel',
  'Karen',
  'Moira',
  'Tessa',
]);

router.post('/tts', async (req, res) => {
  const { text, voice = 'Samantha' } = req.body ?? {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Text is required.',
    });
  }

  if (text.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Text must be 10,000 characters or fewer.',
    });
  }

  if (typeof voice !== 'string' || !ALLOWED_VOICES.has(voice)) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported voice. Choose an allowed voice.',
    });
  }

  const id = randomUUID();
  const aiffPath = path.join(OUTPUT_DIR, `${id}.aiff`);
  const wavPath = path.join(OUTPUT_DIR, `${id}.wav`);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    await execFileAsync(
      '/usr/bin/say',
      ['-v', voice, '-o', aiffPath, text.trim()],
      { timeout: 120000, maxBuffer: 1024 * 1024 }
    );

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i', aiffPath,
        '-ar', '22050',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        wavPath,
      ],
      { timeout: 120000, maxBuffer: 1024 * 1024 }
    );

    await fs.unlink(aiffPath).catch(() => undefined);

    return res.status(201).json({
      success: true,
      message: 'Narration generated successfully.',
      audio: {
        filename: `${id}.wav`,
        url: `/assets/outputs/${id}.wav`,
        format: 'wav',
        voice,
      },
    });
  } catch (error) {
    await Promise.all([
      fs.unlink(aiffPath).catch(() => undefined),
      fs.unlink(wavPath).catch(() => undefined),
    ]);

    console.error('TTS generation failed:', error);

    return res.status(500).json({
      success: false,
      error: 'Narration generation failed. Check macOS speech and FFmpeg.',
    });
  }
});

export default router;
