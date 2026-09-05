// scripts/setup.ts
// To run - npx tsx scripts/setup.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import { cwd } from 'process';

const execAsync = promisify(exec);

async function setupAllProjects() {
  const projects = ['tauri', 'tauri-email-filters', 'tauri-personal-assistant'];
  
  console.log('Installing main project dependencies...');
  await execAsync('npm install', { cwd: cwd() });
  
  for (const project of projects) {
    const path = join(cwd(), project);
    if (existsSync(path)) {
      console.log(`Installing ${project} dependencies...`);
      await execAsync('npm install', { cwd: path });
    }
  }
  
  console.log('All dependencies installed!');
}

setupAllProjects().catch(console.error);