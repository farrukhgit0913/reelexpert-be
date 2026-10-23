
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
  'outputs',
);

const FFMPEG_PATH = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const FFPROBE_PATH = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';

const QWEN_TTS_URL = (
  process.env.QWEN_TTS_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

const ALLOWED_VOICES = new Set([
  'Samantha',
  'Alex',
  'Victoria',
  'Daniel',
  'Karen',
  'Moira',
  'Tessa',
  'Ayaan',
  'Mina',
]);

const QWEN_VOICE_INSTRUCTIONS = {
  Ayaan:
    'A cheerful young cartoon boy around 8 years old, speaking English with a naturally youthful, bright, slightly higher-pitched child voice. Playful and curious, clear articulation, natural conversational rhythm. Avoid sounding like a mature adult.',
  Mina:
    'A cheerful young cartoon girl around 8 years old, speaking English with a bright, youthful, slightly higher-pitched child voice. Warm, expressive, playful curiosity, clear articulation and natural conversational rhythm. Avoid sounding like a mature adult.',
} as const;

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
  const qwenSourcePath = path.join(OUTPUT_DIR, `${id}-qwen-source.wav`);
  const wavPath = path.join(OUTPUT_DIR, `${id}.wav`);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    if (voice === 'Ayaan' || voice === 'Mina') {
      console.log(`[TTS] Generating ${voice} narration with Qwen3-TTS`);

      const response = await fetch(`${QWEN_TTS_URL}/v1/tts/design`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.trim(),
          instruct: QWEN_VOICE_INSTRUCTIONS[voice],
          language: 'English',
          temperature: 0.8,
        }),
        signal: AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        throw new Error(
          `Qwen3-TTS returned HTTP ${response.status}: ${details.slice(0, 500)}`,
        );
      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('audio/')) {
        throw new Error(
          `Qwen3-TTS returned an unexpected content type: ${contentType}`,
        );
      }

      const audioBytes = Buffer.from(await response.arrayBuffer());

      if (audioBytes.length === 0) {
        throw new Error('Qwen3-TTS returned an empty audio file.');
      }

      await fs.writeFile(qwenSourcePath, audioBytes);

      await execFileAsync(
        FFMPEG_PATH,
        [
          '-y',
          '-i', qwenSourcePath,
          '-ar', '22050',
          '-ac', '1',
          '-c:a', 'pcm_s16le',
          wavPath,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );

      await fs.unlink(qwenSourcePath).catch(() => undefined);
    } else {
      console.log(`[TTS] Generating ${voice} narration with macOS speech`);

      await execFileAsync(
        '/usr/bin/say',
        ['-v', voice, '-o', aiffPath, text.trim()],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );

      await execFileAsync(
        FFMPEG_PATH,
        [
          '-y',
          '-i', aiffPath,
          '-ar', '22050',
          '-ac', '1',
          '-c:a', 'pcm_s16le',
          wavPath,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );

      await fs.unlink(aiffPath).catch(() => undefined);
    }

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
      fs.unlink(qwenSourcePath).catch(() => undefined),
      fs.unlink(wavPath).catch(() => undefined),
    ]);

    console.error(`[TTS] ${voice} narration generation failed:`, error);

    return res.status(500).json({
      success: false,
      error:
        voice === 'Ayaan' || voice === 'Mina'
          ? 'Qwen3-TTS narration failed. Check the local Qwen server and backend terminal.'
          : 'Narration generation failed. Check macOS speech and FFmpeg.',
    });
  }
});


// Generate a single audio track from dialogue lines spoken by different characters.
router.post('/tts/dialogue', async (req, res) => {
  const {
  lines,
  fallbackVoice = 'Samantha',
  characterVoices = {},
} = req.body ?? {};

  if (
    !Array.isArray(lines) ||
    lines.length < 1 ||
    lines.length > 50
  ) {
    return res.status(400).json({
      success: false,
      error: 'Provide between 1 and 50 dialogue lines.',
    });
  }

  if (
    typeof fallbackVoice !== 'string' ||
    !ALLOWED_VOICES.has(fallbackVoice)
  ) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported fallback voice.',
    });
  }

    if (
    !characterVoices ||
    typeof characterVoices !== 'object' ||
    Array.isArray(characterVoices)
  ) {
    return res.status(400).json({
      success: false,
      error: 'Character voices must be an object.',
    });
  }

  for (const voice of Object.values(characterVoices)) {
    if (typeof voice !== 'string' || !ALLOWED_VOICES.has(voice)) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported character voice.',
      });
    }
  }

  const normalizedLines: Array<{
    text: string;
    voice: string;
    speaker: string;
  }> = [];
  let totalCharacters = 0;

  for (const line of lines) {
    if (
      !line ||
      typeof line.text !== 'string' ||
      !line.text.trim() ||
      typeof line.speaker !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Every dialogue line must contain a speaker and non-empty text.',
      });
    }

    const text = line.text.trim();
    totalCharacters += text.length;

    if (totalCharacters > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Combined dialogue must be 10,000 characters or fewer.',
      });
    }

        const speakerName = line.speaker.trim();
    const speaker = speakerName.toLowerCase();

    const configuredVoice = Object.entries(
      characterVoices as Record<string, string>,
    ).find(
      ([name]) => name.trim().toLowerCase() === speaker,
    )?.[1];

    const voice =
      configuredVoice ??
      (speaker === 'ayaan'
        ? 'Ayaan'
        : speaker === 'mina'
          ? 'Mina'
          : fallbackVoice);

    normalizedLines.push({ text, voice, speaker: line.speaker.trim() });
  }

  const id = randomUUID();
  const finalPath = path.join(OUTPUT_DIR, `${id}.wav`);
  const silencePath = path.join(OUTPUT_DIR, `${id}-silence.wav`);
  const concatPath = path.join(OUTPUT_DIR, `${id}-concat.txt`);
  const temporaryFiles: string[] = [silencePath, concatPath];
  const clipPaths: string[] = [];
  let dialogueTimeline: Array<{
    speaker: string;
    text: string;
    durationSeconds: number;
    startSeconds: number;
    endSeconds: number;
  }> = [];

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    for (let index = 0; index < normalizedLines.length; index++) {
      const line = normalizedLines[index];
      const clipId = randomUUID();
      const clipPath = path.join(OUTPUT_DIR, `${clipId}.wav`);
      const sourcePath = path.join(OUTPUT_DIR, `${clipId}-source.wav`);
      const aiffPath = path.join(OUTPUT_DIR, `${clipId}.aiff`);

      clipPaths.push(clipPath);
      temporaryFiles.push(clipPath, sourcePath, aiffPath);

      console.log(
        `[TTS Dialogue] Line ${index + 1}/${normalizedLines.length}: ${line.voice}`,
      );

      if (line.voice === 'Ayaan' || line.voice === 'Mina') {
        const response = await fetch(`${QWEN_TTS_URL}/v1/tts/design`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: line.text,
            instruct: QWEN_VOICE_INSTRUCTIONS[
              line.voice as keyof typeof QWEN_VOICE_INSTRUCTIONS
            ],
            language: 'English',
            temperature: 0.8,
          }),
          signal: AbortSignal.timeout(180000),
        });

        if (!response.ok) {
          const details = await response.text().catch(() => '');
          throw new Error(
            `Qwen3-TTS failed on dialogue line ${index + 1}: HTTP ${response.status}: ${details.slice(0, 300)}`,
          );
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('audio/')) {
          throw new Error(`Unexpected Qwen3-TTS content type: ${contentType}`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) {
          throw new Error(`Empty audio returned for dialogue line ${index + 1}.`);
        }

        await fs.writeFile(sourcePath, bytes);

        await execFileAsync(
          FFMPEG_PATH,
          [
            '-y', '-i', sourcePath,
            '-ar', '22050', '-ac', '1',
            '-c:a', 'pcm_s16le', clipPath,
          ],
          { timeout: 120000, maxBuffer: 1024 * 1024 },
        );
      } else {
        await execFileAsync(
          '/usr/bin/say',
          ['-v', line.voice, '-o', aiffPath, line.text],
          { timeout: 120000, maxBuffer: 1024 * 1024 },
        );

        await execFileAsync(
          FFMPEG_PATH,
          [
            '-y', '-i', aiffPath,
            '-ar', '22050', '-ac', '1',
            '-c:a', 'pcm_s16le', clipPath,
          ],
          { timeout: 120000, maxBuffer: 1024 * 1024 },
        );
      }
    }

    // Measure each normalized clip and calculate its position in the
    // combined dialogue track, including the existing 0.3-second pauses.
    let timelineCursor = 0;
    dialogueTimeline = [];

    for (let index = 0; index < normalizedLines.length; index++) {
      const line = normalizedLines[index];
      const { stdout } = await execFileAsync(
        FFPROBE_PATH,
        [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          clipPaths[index],
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );

      const clipDuration = Number(stdout.trim());

      if (!Number.isFinite(clipDuration) || clipDuration <= 0) {
        throw new Error(
          `Could not determine duration for dialogue line ${index + 1}.`,
        );
      }

      const startSeconds = timelineCursor;
      const endSeconds = startSeconds + clipDuration;

      dialogueTimeline.push({
        speaker: line.speaker,
        text: line.text,
        durationSeconds: Number(clipDuration.toFixed(3)),
        startSeconds: Number(startSeconds.toFixed(3)),
        endSeconds: Number(endSeconds.toFixed(3)),
      });

      timelineCursor =
        endSeconds + (index < normalizedLines.length - 1 ? 0.3 : 0);
    }

    // Add a short pause between lines so speakers do not run together.
    if (clipPaths.length > 1) {
      await execFileAsync(
        FFMPEG_PATH,
        [
          '-y',
          '-f', 'lavfi',
          '-i', 'anullsrc=r=22050:cl=mono',
          '-t', '0.3',
          '-c:a', 'pcm_s16le',
          silencePath,
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
    }

    const concatEntries: string[] = [];

    for (let index = 0; index < clipPaths.length; index++) {
      concatEntries.push(`file '${clipPaths[index]}'`);

      if (index < clipPaths.length - 1) {
        concatEntries.push(`file '${silencePath}'`);
      }
    }

    await fs.writeFile(concatPath, concatEntries.join('\n') + '\n', 'utf8');

    await execFileAsync(
      FFMPEG_PATH,
      [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-ar', '22050',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        finalPath,
      ],
      { timeout: 180000, maxBuffer: 1024 * 1024 },
    );

    return res.status(201).json({
      success: true,
      message: 'Dialogue audio generated successfully.',
      audio: {
        filename: `${id}.wav`,
        url: `/assets/outputs/${id}.wav`,
        format: 'wav',
        voice: 'dialogue',
        lines: dialogueTimeline,
      },
    });
  } catch (error) {
    await fs.unlink(finalPath).catch(() => undefined);
    console.error('[TTS Dialogue] Generation failed:', error);

    return res.status(500).json({
      success: false,
      error:
        'Dialogue audio generation failed. Check the Qwen3-TTS server and backend terminal.',
    });
  } finally {
    await Promise.all(
      temporaryFiles.map((file) => fs.unlink(file).catch(() => undefined)),
    );
  }
});

export default router;
