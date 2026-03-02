#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const DEFAULT_STORE = 'soundbrenner.myshopify.com';
const DEFAULT_BASE_URL = 'http://127.0.0.1:9292';
const PID_FILE = path.resolve(process.cwd(), '.shopify', 'theme-dev-qa.pid');
const LOG_FILE = path.resolve(process.cwd(), 'tmp', 'theme-dev-qa.log');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = {
    store: DEFAULT_STORE,
    baseUrl: DEFAULT_BASE_URL,
    stop: false,
    help: false,
    captureArgs: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--help' || current === '-h') {
      parsed.help = true;
      continue;
    }
    if (current === '--stop') {
      parsed.stop = true;
      continue;
    }
    if (current === '--store') {
      parsed.store = argv[i + 1] || DEFAULT_STORE;
      i += 1;
      continue;
    }
    if (current === '--base-url') {
      parsed.baseUrl = argv[i + 1] || DEFAULT_BASE_URL;
      parsed.captureArgs.push('--base-url', parsed.baseUrl);
      i += 1;
      continue;
    }
    parsed.captureArgs.push(current);
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run qa:snap -- [options]

Options:
  --store <store-domain>   Shopify store domain (default: ${DEFAULT_STORE})
  --base-url <url>         Preview URL for screenshots (default: ${DEFAULT_BASE_URL})
  --stop                   Stop background theme dev started by qa:snap
  --help, -h               Show this help

Any additional options are forwarded to visual:capture.
Examples:
  npm run qa:snap
  npm run qa:snap -- --page product-desktop
  npm run qa:snap -- --base-url http://127.0.0.1:9292 --page home-mobile
  npm run qa:stop
`);
}

async function isServerUp(baseUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal
    });
    clearTimeout(timer);
    return response.status >= 200 && response.status < 500;
  } catch (_) {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      ...options
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(0);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function startThemeDev(store) {
  await fs.mkdir(path.dirname(PID_FILE), { recursive: true });
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });

  const logHandle = await fs.open(LOG_FILE, 'a');
  const child = spawn(
    'shopify',
    ['theme', 'dev', '--store', store, '--host', '127.0.0.1', '--port', '9292'],
    {
      detached: true,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
      cwd: process.cwd()
    }
  );
  child.unref();
  await fs.writeFile(PID_FILE, String(child.pid), 'utf8');
  await logHandle.close();
  return child.pid;
}

async function stopThemeDev() {
  try {
    const rawPid = (await fs.readFile(PID_FILE, 'utf8')).trim();
    const pid = Number.parseInt(rawPid, 10);
    if (!Number.isFinite(pid)) {
      throw new Error('Invalid PID file.');
    }
    process.kill(pid, 'SIGTERM');
    await fs.rm(PID_FILE, { force: true });
    console.log(`Stopped theme dev process ${pid}.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No QA theme dev process PID file found.');
      return;
    }
    if (error.code === 'ESRCH') {
      await fs.rm(PID_FILE, { force: true });
      console.log('Theme dev process was not running; cleaned PID file.');
      return;
    }
    throw error;
  }
}

async function waitForServer(baseUrl, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerUp(baseUrl)) return true;
    await sleep(1000);
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.stop) {
    await stopThemeDev();
    return;
  }

  let serverUp = await isServerUp(args.baseUrl);
  if (!serverUp) {
    const pid = await startThemeDev(args.store);
    console.log(`Started shopify theme dev in background (PID ${pid}).`);
    console.log(`Log file: ${LOG_FILE}`);
    console.log('Waiting for preview server...');
    serverUp = await waitForServer(args.baseUrl);
  }

  if (!serverUp) {
    throw new Error(
      `Theme preview did not become available at ${args.baseUrl}. Check ${LOG_FILE} for details.`
    );
  }

  await runCommand('npm', ['run', 'visual:capture', '--', ...args.captureArgs]);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
