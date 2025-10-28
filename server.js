// server.js
const express = require('express');
const morgan = require('morgan');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
const DEFAULT_URL = 'https://whitebit.com/trade/XTZ-USDT';
const TARGET_URL = process.env.TARGET_URL || DEFAULT_URL;

// 보기 전용 옵션
const ENABLE_INPUT = false;        // ← 입력 완전 차단 (true로 바꾸면 다시 활성화)
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const FPS = 10;
const JPEG_QUALITY = 60;

const app = express();
app.use(morgan('dev'));
app.use(express.static('public')); // viewer.html 제공

let browser, page, captureLoopOn = false;

async function launch() {
  if (browser) return;
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 120000 });
  console.log('[puppeteer] Opened:', TARGET_URL);
}

async function ensureCaptureLoop(wss) {
  if (captureLoopOn) return;
  captureLoopOn = true;
  const frameInterval = Math.max(1000 / FPS, 10);
  console.log('[capture] start loop');

  while (captureLoopOn) {
    try {
      if (wss.clients.size === 0) { 
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      const buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(buf);
      }
      await new Promise(r => setTimeout(r, frameInterval));
    } catch (e) {
      console.error('[capture] error', e.message);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

const server = app.listen(PORT, async () => {
  console.log(`Server http://localhost:${PORT}`);
  await launch();
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[ws] viewer connected; total:', wss.clients.size);
  ensureCaptureLoop(wss);

  // ⚠️ 보기 전용: 모든 입력 메시지 무시 (혹은 아예 핸들러 제거)
  ws.on('message', () => {
    if (!ENABLE_INPUT) return; // 그냥 drop
    // 입력을 다시 열고 싶다면, 여기서 JSON 파싱/puppeteer mouse/keyboard 처리 로직 복원
  });

  ws.on('close', () => {
    console.log('[ws] viewer disconnected; total:', wss.clients.size);
  });
});

async function shutdown() {
  console.log('Shutting down...');
  captureLoopOn = false;
  if (browser) await browser.close().catch(()=>{});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
