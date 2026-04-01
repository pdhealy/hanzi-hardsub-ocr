// Simpler test - just load extension and check console
const { chromium } = require('playwright');
const path = require('path');

async function testExtensionSimple() {
  console.log('=== Testing Extension Load ===\n');
  
  const extensionPath = path.join(__dirname, 'extension');
  console.log('Extension path:', extensionPath);
  
  const userDataDir = path.join(__dirname, 'test-user-data');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect all console messages
  const messages = [];
  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    messages.push(text);
    console.log(text);
  });

  page.on('pageerror', error => {
    const text = `[ERROR] ${error.message}`;
    messages.push(text);
    console.error(text);
  });

  console.log('\n=== Navigating to YouTube ===\n');
  
  try {
    await page.goto('https://www.youtube.com/watch?v=b9YqdhL14X4', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log('\n=== Page loaded, waiting for extension ===\n');
    await page.waitForTimeout(5000);

    // Check if content script loaded
    const scriptLoaded = await page.evaluate(() => {
      return !!document.querySelector('script[src*="content.bundle.js"]') || 
             window.hasOwnProperty('YCR_LOADED');
    });
    
    console.log('\nContent script detected:', scriptLoaded);

    // Try to access chrome.runtime from page
    const hasRuntime = await page.evaluate(() => {
      return typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';
    });
    
    console.log('Chrome runtime available:', hasRuntime);

  } catch (error) {
    console.error('\nNavigation error:', error.message);
  }

  await page.waitForTimeout(3000);

  console.log('\n=== Test Complete ===');
  console.log('Total console messages:', messages.length);
  
  if (messages.length === 0) {
    console.log('⚠️  No console messages detected - extension may not be loading');
  }

  await browser.close();
}

testExtensionSimple().catch(console.error);
