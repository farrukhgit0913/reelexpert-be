import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  res.json({
    success: true,
    status: 'ok',
    service: 'reelexpert-backend',
    timestamp: new Date().toISOString()
  });
});

export default router;
