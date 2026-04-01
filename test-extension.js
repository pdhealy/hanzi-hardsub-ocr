// Test script to load the extension and diagnose OCR issues
const { chromium } = require('playwright');
const path = require('path');

async function testExtension() {
  console.log('Starting extension test...');
  
  // Launch browser with extension
  const extensionPath = path.join(__dirname, 'extension');
  console.log('Extension path:', extensionPath);
  
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage'
    ]
  });

  // Get the service worker and listen to console
  console.log('Waiting for service worker...');
  let serviceWorker = context.serviceWorkers()[0];
  
  if (!serviceWorker) {
    await context.waitForEvent('serviceworker');
    serviceWorker = context.serviceWorkers()[0];
  }

  if (serviceWorker) {
    console.log('Service worker found:', serviceWorker.url());
    serviceWorker.on('console', msg => {
      console.log(`[SERVICE WORKER] ${msg.type()}: ${msg.text()}`);
    });
  }

  // Create a new page
  const page = await context.newPage();
  
  // Listen to page console
  page.on('console', msg => {
    console.log(`[PAGE] ${msg.type()}: ${msg.text()}`);
  });

  // Listen to page errors
  page.on('pageerror', error => {
    console.error('[PAGE ERROR]:', error.message);
  });

  console.log('Navigating to YouTube...');
  
  // Navigate to a YouTube video with Chinese subtitles
  await page.goto('https://www.youtube.com/watch?v=b9YqdhL14X4', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  console.log('Page loaded, waiting for content script...');
  await page.waitForTimeout(3000);

  // Check if extension loaded
  const extensionLoaded = await page.evaluate(() => {
    return window.YCR_LOADED || false;
  });
  console.log('Extension loaded in content:', extensionLoaded);

  // Try to get extension ID
  const extensions = await context.backgroundPages();
  console.log('Background pages:', extensions.length);

  // Wait a bit more to see console logs
  console.log('Waiting for logs...');
  await page.waitForTimeout(5000);

  console.log('\n=== Test Summary ===');
  console.log('Check the logs above for any errors or missing messages');
  console.log('Expected to see: [YCR:Offscreen:HTML] Document loaded');
  console.log('Expected to see: [YCR:Offscreen] Script loaded');
  
  // Keep browser open for inspection
  console.log('\nBrowser will stay open for 10 seconds for final logs...');
  await page.waitForTimeout(10000);

  await context.close();
}

testExtension().catch(console.error);
