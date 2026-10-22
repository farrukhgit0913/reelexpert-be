
import type { Request, Response } from 'express';
import { generateReel } from '../services/ollama.service';

const allowedDurations = [15, 30, 45, 60, 90];

export async function createScript(
  req: Request,
  res: Response
): Promise<void> {
  const {
    topic,
    audience = 'General audience',
    platform = 'Instagram Reels',
    language = 'English',
    duration = 30,
    style = 'Engaging',
    mode = 'standard'
  } = req.body ?? {};

  if (typeof topic !== 'string' || !topic.trim() || typeof mode !== 'string' ||
!['standard', 'cartoon'].includes(mode)) {
    res.status(400).json({
      success: false,
      message: 'Please provide a topic for your reel.'
    });
    return;
  }

  if (
    topic.length > 2000 ||
    !allowedDurations.includes(Number(duration)) ||
    typeof audience !== 'string' ||
    typeof platform !== 'string' ||
    typeof language !== 'string' ||
    typeof style !== 'string' ||
    [audience, platform, language, style].some(
      value => value.length > 100
    )
  ) {
    res.status(400).json({
      success: false,
      message: 'Invalid reel settings.'
    });
    return;
  }

  try {
    const reel = await generateReel({
      topic: topic.trim(),
      audience,
      platform,
      language,
      duration: Number(duration),
      style,
      mode: mode as 'standard' | 'cartoon'
    });

    res.json({
      success: true,
      reel
    });
  } catch (error) {
    console.error('Reel generation error:', error);

    const timedOut =
      error instanceof Error &&
      error.name === 'TimeoutError';

    res.status(
      timedOut ? 504 :
      error instanceof Error &&
      error.message === 'OLLAMA_REQUEST_FAILED' ? 502 : 500
    ).json({
      success: false,
      message: timedOut
        ? 'AI generation timed out. Please try again.'
        : error instanceof Error &&
          error.message === 'OLLAMA_REQUEST_FAILED'
          ? 'AI generation failed. Check that Ollama is running and the model is available.'
          : 'Unable to generate the reel script. Please check your Ollama setup.'
    });
  }
}