import express, { Request, Response } from "express";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const router = express.Router();

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

const OUTPUT_DIR = path.resolve(
  process.cwd(),
  "assets",
  "outputs",
  "cartoon-scenes"
);

interface CartoonCharacter {
  name: string;
  appearance: string;
  personality?: string;
  voiceDescription?: string;
}

interface CartoonScene {
  sceneNumber: number;
  visual: string;
  speaker?: string;
  dialogue?: string;
  voiceover?: string;
}

function buildPrompt(
  scene: CartoonScene,
  characters: CartoonCharacter[]
): string {
  const characterDescriptions = characters
    .map((character) => `${character.name}: ${character.appearance}`)
    .join("\n");

  return [
    "Create one polished 3D animated, family-friendly cartoon frame.",
    "Vertical portrait composition, 9:16 aspect ratio.",
    "Bright cinematic lighting, expressive faces, appealing colors.",
    "High-quality animated feature-film aesthetic.",
    "Keep character designs consistent with these descriptions:",
    characterDescriptions,
    `Scene ${scene.sceneNumber}: ${scene.visual}`,
    "Show the described characters performing the action.",
    "Use a clear, visually readable composition.",
    "No words, letters, subtitles, logos, or watermarks."
  ].join("\n").slice(0, 2048);
}

router.post(
  "/scenes",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;

      if (!accountId || !apiToken) {
        res.status(500).json({
          success: false,
          message:
            "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in backend .env."
        });
        return;
      }

      const { scenes, characters } = req.body as {
        scenes?: CartoonScene[];
        characters?: CartoonCharacter[];
      };

      if (!Array.isArray(scenes) || scenes.length === 0) {
        res.status(400).json({
          success: false,
          message: "Provide a non-empty scenes array."
        });
        return;
      }

      if (!Array.isArray(characters)) {
        res.status(400).json({
          success: false,
          message: "Provide a characters array."
        });
        return;
      }

      if (scenes.length > 10) {
        res.status(400).json({
          success: false,
          message: "Generate no more than 10 scenes per request."
        });
        return;
      }

      await mkdir(OUTPUT_DIR, { recursive: true });

      const generated: Array<{
        sceneNumber: number;
        filename: string;
        path: string;
        prompt: string;
      }> = [];

      for (const scene of scenes) {
        if (
          typeof scene.visual !== "string" ||
          !scene.visual.trim()
        ) {
          res.status(400).json({
            success: false,
            message: `Scene ${scene.sceneNumber} has no visual description.`
          });
          return;
        }

        const prompt = buildPrompt(scene, characters);

        const apiUrl =
          `https://api.cloudflare.com/client/v4/accounts/` +
          `${accountId}/ai/run/${MODEL}`;

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt,
            steps: 4
          }),
          signal: AbortSignal.timeout(120000)
        });

        if (!response.ok) {
          const errorText = await response.text();

          console.error(
            "Cloudflare image generation failed:",
            response.status,
            errorText
          );

          res.status(502).json({
            success: false,
            message:
              `Image generation failed for scene ${scene.sceneNumber}.`,
            status: response.status
          });
          return;
        }

        const contentType =
          response.headers.get("content-type") || "";

        let imageBuffer: Buffer;

        if (contentType.startsWith("image/")) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
        } else {
          const payload = await response.json() as {
            result?: { image?: string };
            image?: string;
            errors?: Array<{ message?: string }>;
          };

          const image = payload.result?.image ?? payload.image;

          if (!image) {
            throw new Error(
              payload.errors?.map((e) => e.message).join("; ") ||
              "Cloudflare response did not contain an image."
            );
          }

          const base64 = image.replace(
            /^data:image\/[^;]+;base64,/,
            ""
          );

          imageBuffer = Buffer.from(base64, "base64");
        }

        if (imageBuffer.length === 0) {
          throw new Error(
            `Empty image returned for scene ${scene.sceneNumber}.`
          );
        }

        const isPng =
          imageBuffer.subarray(0, 8).toString("hex") ===
          "89504e470d0a1a0a";

        const extension = isPng ? "png" : "jpg";

        const filename =
          `scene-${String(scene.sceneNumber).padStart(2, "0")}-` +
          `${randomUUID()}.${extension}`;

        const imagePath = path.join(OUTPUT_DIR, filename);

        await writeFile(imagePath, imageBuffer);

        generated.push({
          sceneNumber: scene.sceneNumber,
          filename,
          path: imagePath,
          prompt
        });
      }

      res.json({
        success: true,
        count: generated.length,
        scenes: generated
      });
    } catch (error) {
      console.error("Cartoon scene generation error:", error);

      res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to generate cartoon scenes."
      });
    }
  }
);

export default router;
