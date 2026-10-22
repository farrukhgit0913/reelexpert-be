import express, { Request, Response } from "express";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client, handle_file } from "@gradio/client";
import 'dotenv/config';

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

const ANIMATED_CLIPS_DIR = path.resolve(
  process.cwd(),
  "assets",
  "outputs",
  "animated-clips"
);

const WAN_SPACE =
  "zerogpu-aoti/wan2-2-fp8da-aoti-faster";

const WAN_SPACE_BASE =
  "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";

router.post(
  "/animate",
  async (req: Request, res: Response): Promise<void> => {
    let outputPath: string | undefined;

    try {
      const { imageFilename, prompt, durationSeconds } =
        req.body ?? {};

      if (
        typeof imageFilename !== "string" ||
        path.basename(imageFilename) !== imageFilename ||
        imageFilename.includes("..") ||
        ![".jpg", ".jpeg", ".png", ".webp"].includes(
          path.extname(imageFilename).toLowerCase()
        )
      ) {
        res.status(400).json({
          success: false,
          message: "Provide a valid cartoon image filename."
        });
        return;
      }

      const duration =
        durationSeconds === undefined ? 5 : Number(durationSeconds);

      if (!Number.isFinite(duration) || duration < 0.5 || duration > 5) {
        res.status(400).json({
          success: false,
          message: "durationSeconds must be between 0.5 and 5."
        });
        return;
      }

      const imagePath = path.join(
        OUTPUT_DIR,
        imageFilename
      );

      await fs.access(imagePath);
      await mkdir(ANIMATED_CLIPS_DIR, { recursive: true });

      const motionPrompt =
        typeof prompt === "string" && prompt.trim()
          ? prompt.trim().slice(0, 1500)
          : "Animate this 3D cartoon scene with smooth natural body movement, expressive faces, consistent characters and cinematic motion. No cuts or character distortion.";

      console.log("Connecting to Wan 2.2...");

      const hfToken = process.env.HF_TOKEN?.trim();

      const client = await Client.connect(
        WAN_SPACE,
        hfToken ? { token: hfToken } : {}
      );

      console.log("Submitting image for animation...");

      const result = await client.predict("/generate_video", {
        input_image: await handle_file(imagePath),
        prompt: motionPrompt,
        steps: 6,
        negative_prompt:
          "static image, frozen movement, distorted faces, " +
          "extra limbs, extra fingers, flicker, subtitles, " +
          "watermarks, blurry details",
        duration_seconds: duration,
        guidance_scale: 1,
        guidance_scale_2: 1,
        seed: 42,
        randomize_seed: true
      });

      const video = result.data[0] as {
        url?: string;
        path?: string;
        orig_name?: string;
      };

      if (!video || typeof video.url !== "string") {
        throw new Error(
          "Wan returned no downloadable video URL. " +
          JSON.stringify(video)
        );
      }

      const downloadUrl = new URL(
        video.url,
        WAN_SPACE_BASE
      ).toString();

      const videoResponse = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(120000)
      });

      if (!videoResponse.ok) {
        throw new Error(
          `Could not download Wan video: HTTP ${videoResponse.status}`
        );
      }

      const contentType =
        videoResponse.headers.get("content-type") || "";

      if (
        !contentType.startsWith("video/") &&
        !contentType.includes("octet-stream")
      ) {
        throw new Error(
          `Unexpected video response type: ${contentType}`
        );
      }

      const videoBuffer = Buffer.from(
        await videoResponse.arrayBuffer()
      );

      if (videoBuffer.length === 0) {
        throw new Error("Wan returned an empty video.");
      }

      const filename = `${randomUUID()}.mp4`;
      outputPath = path.join(ANIMATED_CLIPS_DIR, filename);

      await writeFile(outputPath, videoBuffer);

      console.log("Wan animation saved:", filename);

      res.status(201).json({
        success: true,
        message: "Animated cartoon clip generated.",
        clip: {
          filename,
          url: `/assets/outputs/animated-clips/${filename}`,
          durationSeconds: duration,
          sizeBytes: videoBuffer.length,
          provider: "wan-2.2"
        }
      });
    } catch (error) {
      if (outputPath) {
        await fs.unlink(outputPath).catch(() => undefined);
      }

      console.error("Wan animation failed:", error);

      res.status(502).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Wan animation failed. Try again later."
      });
    }
  }
);

export default router;
