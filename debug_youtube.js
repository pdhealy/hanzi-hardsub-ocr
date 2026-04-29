const { chromium } = require('playwright');
const fs = require('fs');

async function test() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('https://www.youtube.com', { waitUntil: 'networkidle' });
  
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .ycr-text ruby {
        display: inline-flex !important;
        flex-direction: column-reverse !important;
        align-items: center !important;
        vertical-align: bottom !important;
        line-height: 1 !important;
      }
      .ycr-text rt {
        display: block !important;
        font-size: 0.5em !important;
        line-height: 1 !important;
        text-align: center !important;
      }
      .ycr-ruby-text {
        display: inline-flex !important;
        justify-content: center !important;
        width: 0px !important;
        overflow: visible !important;
        white-space: nowrap !important;
        direction: ltr !important;
      }
      .ycr-text {
        font-size: 40px;
        position: fixed;
        top: 100px;
        left: 100px;
        z-index: 999999;
        background: white;
        border: 1px solid black;
        white-space: pre-wrap;
      }
    `;
    document.head.appendChild(style);
    
    const div = document.createElement('div');
    div.className = 'ycr-text';
    div.innerHTML = '<ruby>窗<rt><span class="ycr-ruby-text">chuang</span></rt></ruby>';
    document.body.appendChild(div);
  });
  
  await page.waitForTimeout(1000);
  
  const rects = await page.evaluate(() => {
    const ruby = document.querySelector('.ycr-text ruby');
    const rt = document.querySelector('.ycr-text rt');
    return {
      ruby: ruby.getBoundingClientRect(),
      rt: rt.getBoundingClientRect()
    };
  });
  
  console.log(JSON.stringify(rects, null, 2));
  await browser.close();
}

test();
