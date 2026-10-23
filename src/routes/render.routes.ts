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
const CARTOON_DIR = path.join(OUTPUT_DIR, 'cartoon-scenes');
const ANIMATED_CLIPS_DIR = path.join(OUTPUT_DIR, 'animated-clips');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const FFMPEG_PATH = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const FFPROBE_PATH = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';

const TITLES = [
  'YOUR NEXT BIG IDEA',
  'TURN IDEAS INTO ACTION',
  'CREATE SOMETHING AMAZING',
];

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

router.get('/footage', async (_req, res) => {
  try {
    await fs.mkdir(VIDEO_DIR, { recursive: true });

    const files = await fs.readdir(VIDEO_DIR);

    const videos = files
      .filter((name) =>
        VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())
      )
      .sort();

    return res.json({ success: true, videos });
  } catch (error) {
    console.error('Failed to list stock footage:', error);

    return res.status(500).json({
      success: false,
      error: 'Could not load stock footage.',
    });
  }
});

router.post('/render', async (req, res) => {
  const {
    videoFilename,
    audioFilename,
    cartoonSceneFilenames,
    animatedClipFilenames,
    sceneDurations,
  } = req.body ?? {};

  const animatedMode =
    Array.isArray(animatedClipFilenames) &&
    animatedClipFilenames.length > 0;

  const cartoonMode =
    !animatedMode &&
    Array.isArray(cartoonSceneFilenames) &&
    cartoonSceneFilenames.length > 0;

  // Validate narration audio.
  if (
    !isSafeFilename(audioFilename) ||
    !AUDIO_EXTENSIONS.has(path.extname(audioFilename).toLowerCase())
  ) {
    return res.status(400).json({
      success: false,
      error: 'Provide a valid narration audio filename.',
    });
  }

  // Validate the selected source mode.
  if (animatedMode) {
    if (
      animatedClipFilenames.length > 30 ||
      !animatedClipFilenames.every(
        (filename: unknown) =>
          isSafeFilename(filename) &&
          VIDEO_EXTENSIONS.has(
            path.extname(filename).toLowerCase()
          )
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Provide 1 to 30 valid animated clip filenames.',
      });
    }
  } else if (cartoonMode) {
    if (
      cartoonSceneFilenames.length > 30 ||
      !cartoonSceneFilenames.every(
        (filename: unknown) =>
          isSafeFilename(filename) &&
          IMAGE_EXTENSIONS.has(
            path.extname(filename).toLowerCase()
          )
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Provide 1 to 30 valid cartoon image filenames.',
      });
    }
  } else {
    if (
      !isSafeFilename(videoFilename) ||
      !VIDEO_EXTENSIONS.has(path.extname(videoFilename).toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        error: 'Provide a valid source video filename.',
      });
    }
  }

  const audioPath = path.join(OUTPUT_DIR, audioFilename);
  const outputFilename = `${randomUUID()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.access(audioPath);

    let sourceFiles: string[] = [];

    if (animatedMode) {
      sourceFiles = animatedClipFilenames as string[];

      await Promise.all(
        sourceFiles.map((filename) =>
          fs.access(path.join(ANIMATED_CLIPS_DIR, filename))
        )
      );
    } else if (cartoonMode) {
      sourceFiles = cartoonSceneFilenames as string[];

      await Promise.all(
        sourceFiles.map((filename) =>
          fs.access(path.join(CARTOON_DIR, filename))
        )
      );
    } else {
      await fs.access(path.join(VIDEO_DIR, videoFilename));

      sourceFiles = (await fs.readdir(VIDEO_DIR))
        .filter((name) =>
          VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())
        )
        .sort();

      if (!sourceFiles.length) {
        throw new Error('No stock footage found.');
      }
    }

    // Determine the narration duration.
    const probe = await execFileAsync(FFPROBE_PATH, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);

    const duration = Number.parseFloat(probe.stdout.trim());

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Invalid narration duration.');
    }

    const sceneCount = animatedMode
      ? sourceFiles.length
      : cartoonMode
        ? sourceFiles.length
        : 3;

    if (sceneDurations !== undefined) {
      if (
        !animatedMode ||
        !Array.isArray(sceneDurations) ||
        sceneDurations.length !== sceneCount ||
        !sceneDurations.every(
          (value: unknown) =>
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value > 0
        )
      ) {
        return res.status(400).json({
          success: false,
          error: 'Scene durations must contain one positive duration per animated clip.',
        });
      }

      const totalSceneDuration = sceneDurations.reduce(
        (sum: number, value: number) => sum + value,
        0
      );

      if (Math.abs(totalSceneDuration - duration) > 0.5) {
        return res.status(400).json({
          success: false,
          error: 'Scene durations must add up to the narration audio duration.',
        });
      }
    }

    const sceneDuration = duration / sceneCount;
    const inputArgs: string[] = [];
    const filters: string[] = [];

    // Add one video/image input per scene.
    for (let i = 0; i < sceneCount; i++) {
      if (animatedMode) {
        inputArgs.push(
          '-i',
          path.join(ANIMATED_CLIPS_DIR, sourceFiles[i])
        );
      } else if (cartoonMode) {
        const imagePath = path.join(CARTOON_DIR, sourceFiles[i]);

        inputArgs.push(
          '-loop',
          '1',
          '-framerate',
          '30',
          '-t',
          String(sceneDuration),
          '-i',
          imagePath
        );
      } else {
        const filename =
          i === 0
            ? videoFilename
            : sourceFiles[i % sourceFiles.length];

        inputArgs.push(
          '-stream_loop',
          '-1',
          '-i',
          path.join(VIDEO_DIR, filename)
        );
      }
    }

    // Add narration exactly once as the final input.
    inputArgs.push('-i', audioPath);

    // Prepare every scene for portrait video output.
    for (let i = 0; i < sceneCount; i++) {
      const currentSceneDuration =
        animatedMode && Array.isArray(sceneDurations)
          ? sceneDurations[i]
          : sceneDuration;
      const fadeOutStart = Math.max(0, currentSceneDuration - 0.35);

      const title = !cartoonMode && !animatedMode
        ? TITLES[i % TITLES.length].replace(/[^A-Za-z0-9 ]/g, '')
        : '';

      const titleFilter = title
        ? `drawtext=text='${title}':fontcolor=white:fontsize=62:` +
          `borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.72:` +
          `alpha='if(lt(t,0.4),t/0.4,1)',`
        : '';

      if (animatedMode) {
        // Preserve AI-generated motion.
        // Extend short clips by holding the final frame.
        filters.push(
          `[${i}:v]` +
          `setpts=PTS-STARTPTS,` +
          `scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920,` +
          `fps=30,` +
          `tpad=stop_mode=clone:stop_duration=${currentSceneDuration},` +
          `trim=duration=${currentSceneDuration},` +
          `setpts=PTS-STARTPTS,` +
          `fade=t=in:st=0:d=0.35,` +
          `fade=t=out:st=${fadeOutStart}:d=0.35,` +
          `setsar=1,format=yuv420p[v${i}]`
        );
      } else {
        // Preserve the existing still-cartoon and stock-footage behavior.
        filters.push(
          `[${i}:v]` +
          `trim=duration=${sceneDuration},` +
          `setpts=PTS-STARTPTS,` +
          `scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920,` +
          `zoompan=z='min(zoom+0.0006,1.08)':` +
          `x='iw/2-(iw/zoom/2)':` +
          `y='ih/2-(ih/zoom/2)':` +
          `d=1:s=1080x1920:fps=30,` +
          titleFilter +
          `fade=t=in:st=0:d=0.35,` +
          `fade=t=out:st=${fadeOutStart}:d=0.35,` +
          `setsar=1,format=yuv420p[v${i}]`
        );
      }
    }

    // Join all scene video streams.
    filters.push(
      `${Array.from(
        { length: sceneCount },
        (_, i) => `[v${i}]`
      ).join('')}` +
      `concat=n=${sceneCount}:v=1:a=0[outv]`
    );

    // The narration input index equals sceneCount.
    await execFileAsync(
      FFMPEG_PATH,
      [
        '-y',
        ...inputArgs,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[outv]',
        '-map',
        `${sceneCount}:a:0`,
        '-t',
        String(duration),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '44100',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      {
        timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const stats = await fs.stat(outputPath);

    if (!stats.size) {
      throw new Error('FFmpeg generated an empty file.');
    }

    return res.status(201).json({
      success: true,
      message: animatedMode
        ? 'AI-animated cartoon reel rendered successfully.'
        : cartoonMode
          ? 'Cartoon reel rendered successfully.'
          : 'Animated reel rendered successfully.',
      video: {
        filename: outputFilename,
        url: `/assets/outputs/${outputFilename}`,
        format: 'mp4',
        width: 1080,
        height: 1920,
        durationSeconds: duration,
        scenes: sceneCount,
        mode: animatedMode
          ? 'ai-animated-cartoon'
          : cartoonMode
            ? 'cartoon'
            : 'standard',
        sizeBytes: stats.size,
      },
    });
  } catch (error) {
    await fs.unlink(outputPath).catch(() => undefined);

    if (error instanceof Error) {
      console.error('Video rendering failed:', error.message);

      const details = error as Error & {
        stderr?: string;
        stdout?: string;
      };

      console.error(
        'FFmpeg stderr:',
        details.stderr ?? 'No stderr available'
      );
      console.error(
        'FFmpeg stdout:',
        details.stdout ?? ''
      );
    } else {
      console.error('Video rendering failed:', error);
    }

    return res.status(500).json({
      success: false,
      error:
        'Video rendering failed. Check FFmpeg, ffprobe, and input files.',
    });
  }
});

export default router;