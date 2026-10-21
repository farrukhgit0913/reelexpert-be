import { Router } from 'express';
import { createScript } from '../controllers/scripts.controller.js';

const router = Router();

router.post('/scripts', createScript);

export default router;