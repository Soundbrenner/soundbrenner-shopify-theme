#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function printHelp() {
  console.log(`
Usage:
  npm run visual:capture -- [options]

Options:
  --base-url <url>      Base URL (default: http://127.0.0.1:9292)
  --config <path>       Config JSON path (default: scripts/visual-capture.config.json)
  --out-dir <path>      Output directory (default: tmp/visual-captures/<timestamp>)
  --page <name>         Capture only one page name (repeatable)
  --headed              Run browser in headed mode
  --help                Show this help
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:9292',
    config: 'scripts/visual-capture.config.json',
    outDir: '',
    headed: false,
    pages: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--help') {
      args.help = true;
      continue;
    }
    if (current === '--headed') {
      args.headed = true;
      continue;
    }
    if (current === '--base-url') {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === '--config') {
      args.config = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === '--out-dir') {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === '--page') {
      args.pages.push(argv[i + 1]);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return args;
}

function sanitizeName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'capture';
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/[.]/g, '-');
}

async function runAction(page, action, stepIndex) {
  if (!action || typeof action !== 'object') {
    throw new Error(`Action at index ${stepIndex} must be an object.`);
  }

  const type = action.type;
  const timeout = Number.isFinite(action.timeout) ? action.timeout : 5000;

  if (type === 'wait') {
    const ms = Number.isFinite(action.ms) ? action.ms : 250;
    await page.waitForTimeout(ms);
    return;
  }

  if (type === 'waitForSelector') {
    if (!action.selector) throw new Error(`waitForSelector action ${stepIndex} is missing selector.`);
    await page.waitForSelector(action.selector, {
      state: action.state || 'visible',
      timeout
    });
    return;
  }

  if (type === 'click' || type === 'hover' || type === 'focus' || type === 'type') {
    if (!action.selector) throw new Error(`${type} action ${stepIndex} is missing selector.`);
    const locator = page.locator(action.selector).first();
    await locator.waitFor({ state: action.state || 'visible', timeout });

    if (type === 'click') {
      await locator.click({ timeout });
      return;
    }
    if (type === 'hover') {
      await locator.hover({ timeout });
      return;
    }
    if (type === 'focus') {
      await locator.focus();
      return;
    }
    if (type === 'type') {
      await locator.fill('');
      await locator.type(String(action.text || ''), {
        delay: Number.isFinite(action.delay) ? action.delay : 0
      });
      return;
    }
  }

  if (type === 'press') {
    if (!action.key) throw new Error(`press action ${stepIndex} is missing key.`);
    await page.keyboard.press(action.key);
    return;
  }

  if (type === 'scroll') {
    if (action.selector) {
      const locator = page.locator(action.selector).first();
      await locator.waitFor({ state: action.state || 'attached', timeout });
      await locator.scrollIntoViewIfNeeded();
    } else {
      const x = Number.isFinite(action.x) ? action.x : 0;
      const y = Number.isFinite(action.y) ? action.y : 0;
      await page.evaluate(
        ({ nextX, nextY }) => {
          window.scrollTo(nextX, nextY);
        },
        { nextX: x, nextY: y }
      );
    }
    return;
  }

  if (type === 'evaluate') {
    if (!action.script) throw new Error(`evaluate action ${stepIndex} is missing script.`);
    await page.evaluate(action.script);
    return;
  }

  if (type === 'screenshot') {
    if (!action.path) throw new Error(`screenshot action ${stepIndex} is missing path.`);
    await page.screenshot({
      path: action.path,
      fullPage: action.fullPage !== false
    });
    return;
  }

  throw new Error(`Unsupported action type at index ${stepIndex}: ${type}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const configPath = path.resolve(cwd, args.config);
  const configRaw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configRaw);

  const configuredPages = Array.isArray(config.pages) ? config.pages : [];
  if (!configuredPages.length) {
    throw new Error(`No pages found in config: ${configPath}`);
  }

  const selectedPages = args.pages.length
    ? configuredPages.filter((entry) => args.pages.includes(entry.name))
    : configuredPages;

  if (!selectedPages.length) {
    throw new Error('No matching pages selected.');
  }

  const outDir = args.outDir
    ? path.resolve(cwd, args.outDir)
    : path.resolve(cwd, 'tmp', 'visual-captures', timestampForPath());
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: !args.headed
  });

  try {
    for (const entry of selectedPages) {
      const pageName = entry.name || entry.path || 'page';
      const safeName = sanitizeName(pageName);
      const fullPage = entry.fullPage !== false;
      const waitUntil = entry.waitUntil || config.waitUntil || 'domcontentloaded';
      const gotoTimeout = Number.isFinite(entry.gotoTimeout) ? entry.gotoTimeout : 45000;
      const viewport = entry.viewport || config.viewport || { width: 1440, height: 2200 };
      const pathValue = entry.path || '/';
      const url = new URL(pathValue, args.baseUrl).toString();

      console.log(`Capturing: ${pageName} -> ${url}`);

      const context = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: true
      });
      const page = await context.newPage();

      await page.goto(url, { waitUntil, timeout: gotoTimeout });

      if (Number.isFinite(entry.waitAfterGotoMs)) {
        await page.waitForTimeout(entry.waitAfterGotoMs);
      }

      const actions = Array.isArray(entry.actions) ? entry.actions : [];
      for (let stepIndex = 0; stepIndex < actions.length; stepIndex += 1) {
        const action = actions[stepIndex];

        if (action.type === 'screenshot' && action.path) {
          const stepPath = path.resolve(outDir, action.path);
          await fs.mkdir(path.dirname(stepPath), { recursive: true });
          await runAction(page, { ...action, path: stepPath }, stepIndex);
          continue;
        }

        await runAction(page, action, stepIndex);
      }

      const screenshotPath = path.join(outDir, `${safeName}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage
      });

      await context.close();
      console.log(`Saved: ${screenshotPath}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`Done. Output directory: ${outDir}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
