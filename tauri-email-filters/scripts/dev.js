import { spawn } from 'child_process';
import net from 'net';

const DEFAULT_PORT = 1425;

function getFreePort(startingPort) {
  return new Promise((resolve) => {
    let port = startingPort;
    const tryPort = () => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          port++;
          tryPort();
        } else {
          resolve(port); // Fallback to the port we tried if some other error occurs
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port);
    };
    tryPort();
  });
}

async function run() {
  try {
    const port = await getFreePort(DEFAULT_PORT);
    console.log(`[dev.js] Found available development port: ${port}`);

    // Create the merged configuration JSON to override build.devUrl
    let configOverride = JSON.stringify({
      build: {
        devUrl: `http://localhost:${port}`
      }
    });

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      configOverride = `"${configOverride.replace(/"/g, '\\"')}"`;
    }

    const npxCmd = isWindows ? 'npx.cmd' : 'npx';

    console.log(`[dev.js] Starting Tauri development server with dynamically assigned port ${port}...`);

    const child = spawn(
      npxCmd,
      ['tauri', 'dev', '--config', configOverride],
      {
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          VITE_PORT: String(port)
        }
      }
    );

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });

    child.on('error', (err) => {
      console.error('[dev.js] Failed to start tauri dev:', err);
      process.exit(1);
    });

  } catch (err) {
    console.error('[dev.js] Error finding free port:', err);
    process.exit(1);
  }
}

run();
