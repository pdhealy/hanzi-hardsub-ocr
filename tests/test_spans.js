const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        .ycr-custom-ruby {
          display: inline-flex !important;
          flex-direction: column-reverse !important;
          align-items: center !important;
          vertical-align: bottom !important;
          line-height: 1 !important;
        }
        .ycr-custom-rt {
          display: inline-flex !important;
          justify-content: center !important;
          font-size: 0.5em !important;
          line-height: 1 !important;
          width: 0px !important;
          overflow: visible !important;
          white-space: nowrap !important;
          direction: ltr !important;
        }
        body { font-family: sans-serif; font-size: 40px; line-height: 2.2; }
      </style>
    </head>
    <body>
      <div class="test1">
        Line: 
        <span class="ycr-custom-ruby">
          <span class="ycr-custom-ruby">窗<span class="ycr-custom-rt">chuang</span></span>
          <span class="ycr-custom-rt">ㄔㄨㄤ</span>
        </span>
        <span class="ycr-custom-ruby">
          <span class="ycr-custom-ruby">口<span class="ycr-custom-rt">kou</span></span>
          <span class="ycr-custom-rt">ㄎㄡˇ</span>
        </span>
      </div>
    </body>
    </html>
  `;
  
  await page.setContent(html);
  await page.screenshot({ path: 'test_spans.png' });
  
  const rects = await page.evaluate(() => {
    const results = {};
    const rubies = document.querySelectorAll('.ycr-custom-ruby');
    const rts = document.querySelectorAll('.ycr-custom-rt');
    results['rubyOuter'] = rubies[0].getBoundingClientRect();
    results['rubyInner'] = rubies[1].getBoundingClientRect();
    results['rtInner'] = rts[0].getBoundingClientRect();
    results['rtOuter'] = rts[1].getBoundingClientRect();
    return results;
  });
  
  console.log(JSON.stringify(rects, null, 2));
  await browser.close();
}

test();
