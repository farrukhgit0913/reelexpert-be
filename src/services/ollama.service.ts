
const OLLAMA_URL = (
  process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
).replace(/\/$/, '');

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

export interface GenerateReelInput {
  topic: string;
  audience: string;
  platform: string;
  language: string;
  duration: number;
}

export interface ReelScene {
  sceneNumber: number;
  duration: number;
  visual: string;
  voiceover: string;
  textOverlay: string;
}

export interface GeneratedReel {
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  scenes: ReelScene[];
  callToAction: string;
}

function extractJson(content: string): unknown {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end <= start) {
      throw new Error('Ollama did not return valid JSON.');
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function normalizeReel(
  value: unknown,
  targetDuration: number
): GeneratedReel {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid reel response from Ollama.');
  }

  const data = value as Record<string, unknown>;

  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error('Ollama returned a reel without scenes.');
  }

  const scenes: ReelScene[] = data.scenes.map(
    (item: unknown, index: number) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Invalid scene at position ${index + 1}.`);
      }

      const scene = item as Record<string, unknown>;

      const rawDuration = Number(scene.duration);
      const duration =
        Number.isFinite(rawDuration) && rawDuration > 0
          ? Math.round(rawDuration)
          : 1;

      return {
        sceneNumber: index + 1,
        duration,
        visual: String(scene.visual ?? ''),
        voiceover: String(scene.voiceover ?? ''),
        textOverlay: String(
          scene.textOverlay ?? scene.text_overlay ?? ''
        ),
      };
    }
  );

  // Adjust scene durations so their total matches the requested duration.
  const totalDuration = scenes.reduce(
    (total, scene) => total + scene.duration,
    0
  );

  let difference = targetDuration - totalDuration;

  while (difference !== 0) {
    if (difference > 0) {
      const index = scenes.reduce(
        (largestIndex, scene, currentIndex, all) =>
          scene.duration > all[largestIndex].duration
            ? currentIndex
            : largestIndex,
        0
      );

      scenes[index].duration += 1;
      difference -= 1;
    } else {
      const candidates = scenes
        .map((scene, index) => ({ scene, index }))
        .filter(({ scene }) => scene.duration > 1);

      if (candidates.length === 0) {
        throw new Error(
          'Unable to normalize scene durations to the requested length.'
        );
      }

      const longest = candidates.reduce((best, current) =>
        current.scene.duration > best.scene.duration ? current : best
      );

      scenes[longest.index].duration -= 1;
      difference += 1;
    }
  }

  return {
    title: String(data.title ?? 'Untitled Reel'),
    hook: String(data.hook ?? ''),
    description: String(data.description ?? ''),
    hashtags: Array.isArray(data.hashtags)
      ? data.hashtags.map(String)
      : [],
    scenes,
    callToAction: String(
      data.callToAction ?? data.call_to_action ?? ''
    ),
  };
}

export async function generateReel(
  input: GenerateReelInput
): Promise<GeneratedReel> {
  const prompt = `
Create a high-quality short-form video script for ReelExpert AI.

Requirements:
- Topic: ${input.topic}
- Target audience: ${input.audience}
- Platform: ${input.platform}
- Language: ${input.language}
- Total duration: exactly ${input.duration} seconds
- Start with a compelling hook in the first 1-3 seconds.
- Make the script engaging, specific, and suitable for the platform.
- Each scene must include a visual direction, voiceover, and text overlay.
- Scene durations must be positive integers.
- All scene durations must add up to exactly ${input.duration} seconds.
- Use natural, spoken language for the voiceover.
- Do not include markdown or explanations outside the JSON.

Return exactly this JSON structure:
{
  "title": "Short engaging title",
  "hook": "Opening hook",
  "description": "Short reel description",
  "hashtags": ["#example", "#example2"],
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 5,
      "visual": "What appears on screen",
      "voiceover": "Words spoken in this scene",
      "textOverlay": "Text displayed on screen"
    }
  ],
  "callToAction": "A relevant closing call to action"
}
`.trim();

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert short-form video scriptwriter. Return valid JSON only. Follow the requested schema exactly.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      format: 'json',
      stream: false,
      think: false,
      options: {
        temperature: 0.3,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Ollama request failed (${response.status}): ${errorText}`
    );
  }

  const result = (await response.json()) as {
    message?: {
      content?: string;
    };
    error?: string;
  };

  if (result.error) {
    throw new Error(`Ollama error: ${result.error}`);
  }

  const content = result.message?.content;

  if (!content) {
    throw new Error('Ollama returned an empty response.');
  }

  const parsed = extractJson(content);

  return normalizeReel(parsed, input.duration);
}
