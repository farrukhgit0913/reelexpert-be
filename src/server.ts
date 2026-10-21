
import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`ReelExpert backend: http://localhost:${PORT}`);
  console.log(`Dashboard:          http://localhost:${PORT}/`);
  console.log(`Service status:      http://localhost:${PORT}/api/status`);
  console.log(`Health check:        http://localhost:${PORT}/api/health`);
  console.log(`Script API:          http://localhost:${PORT}/api/scripts`);
});
