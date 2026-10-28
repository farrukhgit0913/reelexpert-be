import { Router, Request, Response } from "express";
import multer from "multer";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      callback(new Error("Choose a JPG, PNG, or WebP image."));
      return;
    }
    callback(null, true);
  },
});

const FLUX_URL =
  process.env.FLUX_SERVICE_URL ?? "http://127.0.0.1:8765";

router.get("/health", async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${FLUX_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    res.status(response.ok ? 200 : 503).json(data);
  } catch {
    res.status(503).json({
      success: false,
      message: "FLUX.2 Klein service is offline.",
    });
  }
});

router.post(
  "/transform",
  (req: Request, res: Response, next) => {
    upload.single("image")(req, res, (error) => {
      if (error) {
        res.status(400).json({
          success: false,
          message: error.message || "Image upload failed.",
        });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: "Please upload an image.",
        });
        return;
      }

      const style = String(req.body?.style ?? "3d");
      const prompt = String(req.body?.prompt ?? "").trim().slice(0, 1500);

      if (!["anime", "ghibli", "3d", "comic"].includes(style)) {
        res.status(400).json({
          success: false,
          message: "Choose a valid cartoon style.",
        });
        return;
      }

      const response = await fetch(`${FLUX_URL}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: req.file.buffer.toString("base64"),
          style,
          prompt,
        }),
        signal: AbortSignal.timeout(600000),
      });

      if (!response.ok) {
        let message = `FLUX generation failed (HTTP ${response.status}).`;
        try {
          const data = await response.json() as { message?: string };
          if (data.message) message = data.message;
        } catch {
          // Keep the fallback error message.
        }

        res.status(502).json({ success: false, message });
        return;
      }

      const image = Buffer.from(await response.arrayBuffer());

      if (!image.length) {
        res.status(502).json({
          success: false,
          message: "FLUX returned an empty image.",
        });
        return;
      }

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", image.length);
      res.status(200).send(image);
    } catch (error) {
      console.error("Image-to-cartoon generation failed:", error);
      res.status(502).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not generate the cartoon image.",
      });
    }
  },
);

export default router;
