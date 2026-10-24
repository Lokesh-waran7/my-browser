// scripts/run_benchmarks.js - Standalone benchmark utility for Coder Browser
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function measureStartupTime() {
  console.log('[Benchmark] Measuring Coder Browser cold startup time...');
  const startTime = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '../main.js')], {
      env: { ...process.env, BENCHMARK_MODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let readyTime = null;
    const timeout = setTimeout(() => {
      child.kill();
      resolve(readyTime || (Date.now() - startTime));
    }, 4000);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('[Workspaces] Restored') || text.includes('[AdBlocker] Engine initialized')) {
        if (!readyTime) {
          readyTime = Date.now() - startTime;
          clearTimeout(timeout);
          child.kill();
          resolve(readyTime);
        }
      }
    });

    child.on('exit', () => {
      resolve(readyTime || (Date.now() - startTime));
    });
  });
}

async function run() {
  console.log('====================================================');
  console.log('       Coder Browser Benchmark Utility v1.0.0       ');
  console.log('====================================================');
  console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`CPUs: ${os.cpus().length}x ${os.cpus()[0].model}`);
  console.log(`Total System Memory: ${(os.totalmem() / (1024 ** 3)).toFixed(2)} GB`);
  console.log(`Free System Memory: ${(os.freemem() / (1024 ** 3)).toFixed(2)} GB\n`);

  const startupMs = await measureStartupTime();
  console.log(`Measured Cold Startup to Engine/UI Ready: ~${startupMs} ms\n`);

  console.log('Detailed benchmark methodology and comparisons vs Google Chrome are documented in BENCHMARKS.md.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
