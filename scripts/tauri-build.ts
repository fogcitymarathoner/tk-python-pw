// scripts/tauri-build.ts
// To run - npx tsx scripts/tauri-build.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import { cwd } from 'process';

const execAsync = promisify(exec);

interface BuildResult {
  project: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  path: string;
  duration: number;
}

class TauriBuilder {
  private projects: { name: string; path: string }[];
  private results: BuildResult[] = [];
  private startTime: number;

  constructor(basePath: string = cwd()) {
    this.projects = [
      { name: 'tauri', path: join(basePath, 'tauri') },
      { name: 'tauri-email-filters', path: join(basePath, 'tauri-email-filters') },
      { name: 'tauri-personal-assistant', path: join(basePath, 'tauri-personal-assistant') }
    ];
    this.startTime = Date.now();
  }

  private async buildProject(config: { name: string; path: string }): Promise<BuildResult> {
    const projectStart = Date.now();
    
    if (!existsSync(config.path)) {
      return {
        project: config.name,
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `Directory not found: ${config.path}`,
        path: config.path,
        duration: 0
      };
    }

    console.log(`\x1b[33mStarting build for ${config.name}...\x1b[0m`);

    try {
      const { stdout, stderr } = await execAsync(
        'npm run tauri build -- --target x86_64-pc-windows-msvc',
        {
        cwd: config.path,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        timeout: 600000 // 10 minute timeout
      });

      return {
        project: config.name,
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        path: config.path,
        duration: (Date.now() - projectStart) / 1000
      };
    } catch (error: any) {
      return {
        project: config.name,
        success: false,
        exitCode: error.code || -1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || 'Unknown error occurred',
        path: config.path,
        duration: (Date.now() - projectStart) / 1000
      };
    }
  }

  private async runBuilds(): Promise<void> {
    const validProjects = this.projects.filter(p => existsSync(p.path));
    
    if (validProjects.length === 0) {
      console.error('\x1b[31mNo project directories found!\x1b[0m');
      process.exit(1);
    }

    console.log('\x1b[36mStarting Tauri builds in parallel...\x1b[0m');
    console.log('\x1b[36m' + '='.repeat(60) + '\x1b[0m');

    // Run builds in parallel
    const buildPromises = validProjects.map(project => this.buildProject(project));
    this.results = await Promise.all(buildPromises);

    // Show immediate results
    this.results.forEach(result => {
      const icon = result.success ? '✓' : '✗';
      const color = result.success ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      const status = result.success ? 'SUCCESS' : `FAILED (Exit Code: ${result.exitCode})`;
      console.log(`${color}${icon} ${result.project}: ${status} (${result.duration.toFixed(2)}s)${reset}`);
    });
  }

  private printSummary(): void {
    const totalDuration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const successCount = this.results.filter(r => r.success).length;
    const failCount = this.results.filter(r => !r.success).length;

    console.log('\n' + '\x1b[36m' + '='.repeat(60) + '\x1b[0m');
    console.log('\x1b[36mBUILD SUMMARY REPORT\x1b[0m');
    console.log('\x1b[36m' + '='.repeat(60) + '\x1b[0m');

    this.results.forEach(result => {
      const icon = result.success ? '✓' : '✗';
      const color = result.success ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      const status = result.success ? 'SUCCESS' : `FAILED (Exit Code: ${result.exitCode})`;
      console.log(`${color}${icon} ${result.project}: ${status}${reset}`);
      console.log(`  Path: ${result.path}`);
      console.log(`  Duration: ${result.duration.toFixed(2)}s`);
    });

    console.log('\x1b[36m' + '-'.repeat(60) + '\x1b[0m');
    console.log(`Total Projects: ${this.results.length}`);
    console.log(`\x1b[32mSuccessful: ${successCount}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failCount}\x1b[0m`);
    console.log(`Total Duration: ${totalDuration}s`);
    console.log('\x1b[36m' + '='.repeat(60) + '\x1b[0m');

    // Show detailed errors for failed builds
    const failedResults = this.results.filter(r => !r.success);
    if (failedResults.length > 0) {
      console.log('\n\x1b[31mDETAILED ERROR OUTPUT:\x1b[0m');
      console.log('\x1b[31m' + '-'.repeat(60) + '\x1b[0m');
      
      failedResults.forEach(failed => {
        console.log(`\n\x1b[33m[${failed.project}] ERRORS:\x1b[0m`);
        if (failed.stderr) {
          console.log('\x1b[90m' + failed.stderr.trim() + '\x1b[0m');
        } else if (failed.stdout) {
          console.log('\x1b[90m' + failed.stdout.trim() + '\x1b[0m');
        } else {
          console.log('\x1b[90mNo error output captured\x1b[0m');
        }
        console.log('\x1b[31m' + '-'.repeat(60) + '\x1b[0m');
      });
    }
  }

  async build(): Promise<void> {
    await this.runBuilds();
    this.printSummary();

    const hasFailures = this.results.some(r => !r.success);
    process.exit(hasFailures ? 1 : 0);
  }
}

// Run the builder
const builder = new TauriBuilder();
builder.build().catch(error => {
  console.error('\x1b[31mFatal error:\x1b[0m', error);
  process.exit(1);
});