const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        .test1 ruby {
          display: inline-flex;
          flex-direction: column-reverse;
          align-items: center;
          vertical-align: bottom;
          line-height: 1;
        }
        .test1 rt {
          display: block;
          font-size: 0.5em;
          line-height: 1;
          text-align: center;
        }
        .test1 .ycr-ruby-text {
          display: inline-flex;
          justify-content: center;
          width: 0px;
          overflow: visible;
          white-space: nowrap;
        }
        body { font-family: sans-serif; font-size: 40px; line-height: 2.2; }
      </style>
    </head>
    <body>
      <div class="test1">
        Line: 
        <ruby>
          <ruby>窗<rt><span class="ycr-ruby-text">chuang</span></rt></ruby>
          <rt><span class="ycr-ruby-text">ㄔㄨㄤ</span></rt>
        </ruby>
        <ruby>
          <ruby>口<rt><span class="ycr-ruby-text">kou</span></rt></ruby>
          <rt><span class="ycr-ruby-text">ㄎㄡˇ</span></rt>
        </ruby>
      </div>
    </body>
    </html>
  `;
  
  await page.setContent(html);
  await page.screenshot({ path: 'test_flex_ruby.png' });
  
  const rects = await page.evaluate(() => {
    const results = {};
    const rubies = document.querySelectorAll('ruby');
    const rts = document.querySelectorAll('rt');
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
