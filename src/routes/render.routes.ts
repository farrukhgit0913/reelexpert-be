
import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

const router = Router();
const execFileAsync = promisify(execFile);

const ASSETS_DIR = path.resolve(process.cwd(), 'assets');
const VIDEO_DIR = path.join(ASSETS_DIR, 'stock-footage');
const OUTPUT_DIR = path.join(ASSETS_DIR, 'outputs');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a']);

function isSafeFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === path.basename(value) &&
    !value.includes('..') &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

router.post('/render', async (req, res) => {
  const { videoFilename, audioFilename } = req.body ?? {};

  if (
    !isSafeFilename(videoFilename) ||
    !VIDEO_EXTENSIONS.has(path.extname(videoFilename).toLowerCase())
  ) {
    return res.status(400).json({
      success: false,
      error: 'Provide a valid source video filename.',
    });
  }

  if (
    !isSafeFilename(audioFilename) ||
    !AUDIO_EXTENSIONS.has(path.extname(audioFilename).toLowerCase())
  ) {
    return res.status(400).json({
      success: false,
      error: 'Provide a valid narration audio filename.',
    });
  }

  const videoPath = path.join(VIDEO_DIR, videoFilename);
  const audioPath = path.join(OUTPUT_DIR, audioFilename);
  const outputFilename = `${randomUUID()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    await Promise.all([
      fs.access(videoPath),
      fs.access(audioPath),
    ]);

    // Loop the source video, crop it to vertical 9:16,
    // and stop when the narration audio finishes.
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-stream_loop', '-1',
        '-i', videoPath,
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-vf',
        'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-shortest',
        '-movflags', '+faststart',
        outputPath,
      ],
      {
        timeout: 600000,
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    const stats = await fs.stat(outputPath);

    if (stats.size === 0) {
      throw new Error('FFmpeg created an empty output file.');
    }

    return res.status(201).json({
      success: true,
      message: 'Reel rendered successfully.',
      video: {
        filename: outputFilename,
        url: `/assets/outputs/${outputFilename}`,
        format: 'mp4',
        width: 1080,
        height: 1920,
        sizeBytes: stats.size,
      },
    });
  } catch (error) {
    await fs.unlink(outputPath).catch(() => undefined);

    console.error('Video rendering failed:', error);

    return res.status(500).json({
      success: false,
      error:
        'Video rendering failed. Check that the source files exist and FFmpeg supports H.264 encoding.',
    });
  }
});

export default router;
