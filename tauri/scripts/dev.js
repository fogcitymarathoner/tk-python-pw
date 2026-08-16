import { execa } from 'execa';
import getPort from 'get-port';

const preferredPort = 1420;
const port = await getPort({ port: preferredPort }); // Preferred port, falls back if taken

if (port !== preferredPort) {
  console.log(`⚠️ Port ${preferredPort} is already in use. Rolling over to next available port: ${port}`);
} else {
  console.log(`🚀 Starting development server on port ${port}...`);
}

try {
  await execa(
    'pnpm',
    [
      'tauri',
      'dev',
      '--config',
      JSON.stringify({
        build: {
          devUrl: `http://localhost:${port}`,
        },
      }),
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, VITE_PORT: String(port) },
    }
  );
} catch (error) {
  // If the process was terminated by user (Ctrl+C), exit cleanly
  if (error.signal === 'SIGINT' || error.signal === 'SIGTERM') {
    process.exit(0);
  }
  console.error('❌ Tauri development process exited with an error:', error.message || error);
  process.exit(error.exitCode || 1);
}
