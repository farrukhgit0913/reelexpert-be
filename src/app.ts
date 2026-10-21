import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';

import healthRoutes from './routes/health.routes';
import statusRoutes from './routes/status.routes';
import scriptsRoutes from './routes/scripts.routes';
import ttsRoutes from './routes/tts.routes';
import renderRoutes from './routes/render.routes';

const app = express();

// Run npm start from the backend directory.
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(ROOT, 'assets');

// Middleware
app.use(
  cors({
    origin: "*",
  }),
);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  }),
);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// API routes
app.use('/api', healthRoutes);
app.use('/api', statusRoutes);
app.use('/api', scriptsRoutes);
app.use('/api', ttsRoutes);
app.use('/api', renderRoutes);
app.use('/assets', express.static(path.resolve(process.cwd(), 'assets')));

// Static assets: /assets/...
app.use(
  '/assets',
  express.static(ASSETS_DIR, {
    fallthrough: true,
    maxAge: 0,
  })
);

// Dashboard files: backend/public/...
app.use(
  express.static(PUBLIC_DIR, {
    fallthrough: true,
    maxAge: 0,
  })
);

// Dashboard homepage
app.get('/', (_req, res, next) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (error) => {
    if (error) {
      next(error);
    }
  });
});

// Unknown API endpoints must be handled after all API routes.
app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found.',
  });
});

// Error handler
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Server error:', error.message);

    if (res.headersSent) {
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
);

export default app;