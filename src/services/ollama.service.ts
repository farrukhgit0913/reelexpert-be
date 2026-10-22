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
  style?: string;
  mode?: 'standard' | 'cartoon';
}

export interface ReelCharacter {
  name: string;
  appearance: string;
  personality: string;
  voiceDescription: string;
}

export interface ReelScene {
  sceneNumber: number;
  duration: number;
  visual: string;
  voiceover: string;
  textOverlay: string;
  speaker?: string;
  dialogue?: string;
}

export interface GeneratedReel {
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  scenes: ReelScene[];
  callToAction: string;
  mode?: 'standard' | 'cartoon';
  characters?: ReelCharacter[];
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
  targetDuration: number,
  mode: 'standard' | 'cartoon'
): GeneratedReel {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid reel response from Ollama.');
  }

  const data = value as Record<string, unknown>;

  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error('Ollama returned a reel without scenes.');
  }

  const characters: ReelCharacter[] = Array.isArray(data.characters)
    ? data.characters
        .filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === 'object'
        )
        .map((item) => ({
          name: String(item.name ?? ''),
          appearance: String(item.appearance ?? ''),
          personality: String(item.personality ?? ''),
          voiceDescription: String(item.voiceDescription ?? ''),
        }))
    : [];

  if (
    mode === 'cartoon' &&
    (characters.length < 2 ||
      characters.some((character) => !character.name))
  ) {
    throw new Error(
      'Cartoon story must include at least two named characters.'
    );
  }

  const scenes: ReelScene[] = data.scenes.map(
    (item: unknown, index: number) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Invalid scene at position ${index + 1}.`);
      }

      const scene = item as Record<string, unknown>;
      const rawDuration = Number(scene.duration);

      return {
        sceneNumber: index + 1,
        duration:
          Number.isFinite(rawDuration) && rawDuration > 0
            ? Math.round(rawDuration)
            : 1,
        visual: String(scene.visual ?? ''),
        voiceover: String(scene.voiceover ?? ''),
        textOverlay: String(
          scene.textOverlay ?? scene.text_overlay ?? ''
        ),
        ...(mode === 'cartoon'
          ? {
              speaker: String(scene.speaker ?? ''),
              dialogue: String(scene.dialogue ?? ''),
            }
          : {}),
      };
    }
  );

  if (
    mode === 'cartoon' &&
    scenes.some(
      (scene) =>
        !scene.visual.trim() ||
        !scene.speaker?.trim() ||
        !scene.dialogue?.trim()
    )
  ) {
    throw new Error(
      'Cartoon scenes must include a visual, speaker, and dialogue.'
    );
  }

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
        current.scene.duration > best.scene.duration
          ? current
          : best
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
    mode,
    ...(mode === 'cartoon' ? { characters } : {}),
  };
}

export async function generateReel(
  input: GenerateReelInput
): Promise<GeneratedReel> {
  const mode = input.mode === 'cartoon' ? 'cartoon' : 'standard';

  const commonRequirements = `
Topic: ${input.topic}
Target audience: ${input.audience}
Platform: ${input.platform}
Language: ${input.language}
Total duration: exactly ${input.duration} seconds
Content style: ${input.style || 'Engaging'}

Requirements:
- Start with a compelling hook.
- Make the content engaging and suitable for the platform.
- Scene durations must be positive integers and add up to exactly ${input.duration} seconds.
- Return valid JSON only, without markdown or explanations.
`;

  const cartoonInstructions = `
Create a children's cartoon story featuring two or three recurring characters.

Additional requirements:
- Give every character a name, visual appearance, personality, and voice description.
- Keep each character's appearance consistent across all scenes.
- Every scene must describe the setting, character actions, facial expressions, and composition.
- Every scene must have a named speaker and a spoken dialogue line.
- The speaker must be one of the defined characters.
- Use short, natural, child-friendly conversations.
- Create a clear beginning, middle, and ending.
- Include visual descriptions suitable for generating cartoon illustrations.
- Keep dialogue in the requested language.
- Do not claim that images or video have already been generated.

Return this JSON structure:
{
  "title": "Story title",
  "hook": "Opening hook",
  "description": "Short story description",
  "hashtags": ["#CartoonStory", "#KidsStory"],
  "characters": [
    {
      "name": "Ayaan",
      "appearance": "Consistent full character appearance",
      "personality": "Curious and kind",
      "voiceDescription": "Young, cheerful voice"
    },
    {
      "name": "Sara",
      "appearance": "Consistent full character appearance",
      "personality": "Brave and thoughtful",
      "voiceDescription": "Young, friendly voice"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 5,
      "visual": "Detailed cartoon setting, character actions, expressions, and camera composition",
      "speaker": "Ayaan",
      "dialogue": "Sara, look what I found!",
      "voiceover": "Sara, look what I found!",
      "textOverlay": "A surprising discovery!"
    }
  ],
  "callToAction": "What would you do next?"
}
`;

  const standardInstructions = `
Create a high-quality short-form video script.

Requirements:
- Include visual direction, voiceover, and text overlay in each scene.
- Use natural, spoken language.
- Scene durations must add up to the requested duration.

Return this JSON structure:
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
`;

  const prompt =
    commonRequirements +
    (mode === 'cartoon'
      ? cartoonInstructions
      : standardInstructions);

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
            mode === 'cartoon'
              ? 'You are a professional childrens cartoon screenwriter. Create consistent characters and natural dialogue. Return valid JSON only.'
              : 'You are an expert short-form video scriptwriter. Return valid JSON only.',
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
    message?: { content?: string };
    error?: string;
  };

  if (result.error) {
    throw new Error(`Ollama error: ${result.error}`);
  }

  const content = result.message?.content;

  if (!content) {
    throw new Error('Ollama returned an empty response.');
  }

  return normalizeReel(
    extractJson(content),
    input.duration,
    mode
  );
}
