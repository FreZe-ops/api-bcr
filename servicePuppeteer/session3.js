const { firefox } = require('playwright');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const io = require('socket.io-client');
const fs = require('fs').promises;

const { request, imageCapcha, helper } = require('../utilities');
const { account_3: account } = require('./account.puppeteer');

const DOMAIN = process.env.DOMAIN || 'https://www.rr199.com';
const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';

let isCollecting = false;
let socket;
let context;
let page;
let seamlessFrame;
let gameHallFrame;
let gameCurrentFrame;
let sessionCookiePoller;
let timeSendSessionDelay = Number(account.timeSendSessionDelay);
let timeSendSessionNearest = helper.getCurrentTime().timeUnix;
const username_game = account.username_game;
const password_game = account.password_game;
const nameServiceSocket = account.nameServiceSocket;
const logsNameProgress = account.logsNameProgress;

const socketUrl = `${process.env.SERVER_HOSTNAME}:${process.env.SERVER_PORT}`;
socket = io(socketUrl, { transports: ['websocket', 'polling'] });
socket.on('connect', () => console.log(`(SOCKET) Connecting ${socketUrl}`));
socket.on('disconnect', () => console.log('(SOCKET) Disconnected'));
socket.on('connect_error', (e) => console.log('(SOCKET) connect_error:', e.message));
main();

async function main() {
    try {
        const userDataDir = path.join(__dirname, 'dataDir', account.userDataDir);
        context = await firefox.launchPersistentContext(userDataDir, {
            headless: true,
            viewport: { width: 1920, height: 1080 },
            userAgent,
            ignoreHTTPSErrors: true,
        });
        page = context.pages()[0] || await context.newPage();

        await helper.appendToLog('BẮT ĐẦU CHƯƠNG TRÌNH FIREFOX - GHI LOGS', logsNameProgress);
        await helper.appendToLog('='.repeat(50), logsNameProgress);

        page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
        page.on('error', (err) => helper.appendToLog(`Page error: ${err.message}`, logsNameProgress));
        page.on('pageerror', (err) => {
            const msg = (err && err.message) ? err.message : String(err);
            if (/Firebase.*auth\/argument-error/i.test(msg)) return;
            helper.appendToLog(`Page uncaught exception: ${msg}`, logsNameProgress);
        });

        function startCollectingResponses(page, frames = []) {
            isCollecting = true;
            const handleResponse = async (response) => {
                const resSession = await request.CollectingResponseSession(response, isCollecting);
                const timeUnixCurrent = helper.getCurrentTime().timeUnix;
                if (typeof resSession === 'string' && /^[^;\s]+$/.test(resSession) && timeUnixCurrent > (timeSendSessionNearest + timeSendSessionDelay)) {
                    timeSendSessionNearest = timeUnixCurrent;
                    sendSessionData(resSession, nameServiceSocket);
                }
            };
            page.on('response', handleResponse);
            frames.forEach(frame => { if (frame && frame.on) frame.on('response', handleResponse); });
            startSessionCookiePolling();
        }

        await page.goto(DOMAIN, { waitUntil: 'load', timeout: 60000 });
        console.log('Trang web đã được load xong');

        await clickButton(logsNameProgress, page, process.env.CLOSE_DIALOG_WELCOME, 'ĐÓNG THÔNG BÁO SỰ KIỆN');
        await clickButton(logsNameProgress, page, process.env.SHOW_DIALOG_LOGIN, 'HIỂN THỊ DIALOG ĐĂNG NHẬP');
        // Bỏ qua captcha - nhập tài khoản mk luôn
        // await page.waitForSelector('div.captcha_box img', { state: 'visible', timeout: 15000 }).catch(() => {});
        // await helper.delay(3000);
        // const codeCapcha = await imageCapcha.getCodeCapchaLogin(logsNameProgress, page);
        await helper.delay(1000);
        await fillInput(logsNameProgress, page, process.env.INPUT_USERNAME_LOGIN, username_game);
        await fillInput(logsNameProgress, page, process.env.INPUT_PASSWORD_LOGIN, password_game);
        // await fillInput(logsNameProgress, page, process.env.INPUT_CAPCHA_LOGIN, codeCapcha);
        await clickButton(logsNameProgress, page, 'button[type="submit"].submit_btn', 'ĐĂNG NHẬP');
        await helper.delay(5000);
        await clickButton(logsNameProgress, page, process.env.SHOW_DIALOG_LOGIN_SUCCESS, 'ĐÓNG THÔNG BÁO CẢNH BÁO KHI HOÀN TẤT ĐĂNG NHẬP');

        await helper.delay(1000);
        await clickButton(logsNameProgress, page, 'div.header_nav_list div.nav_item:nth-child(2) div.nav_item_btn.LIVE div.name1', 'VÀO MENU GAME SEXY');
        await page.waitForLoadState('load').catch(() => {});
        await helper.delay(1000);
        await scrollDownSlowly(logsNameProgress, page, 1000, 'CUỘN XUỐNG - TÌM NÚT BUTTON VÀO GAME');
        await helper.delay(1000);
        await clickButton(logsNameProgress, page, '.play-btn', 'VÀO SẢNH SEXY');
        await helper.delay(25000);

        await page.waitForSelector('iframe#seamless-game', { timeout: 90000 });
        await page.waitForTimeout(5000);
        const seamlessEl = await page.$('iframe#seamless-game');
        if (!seamlessEl) throw new Error('Không tìm thấy iframe#seamless-game');
        seamlessFrame = await seamlessEl.contentFrame();
        if (!seamlessFrame) throw new Error('Không lấy được contentFrame của iframe#seamless-game');

        await seamlessFrame.waitForSelector('iframe#iframeGameHall', { timeout: 90000, state: 'attached' });
        await page.waitForTimeout(1000);
        let gameHallEl = await seamlessFrame.$('iframe#iframeGameHall');
        if (!gameHallEl) throw new Error('Không tìm thấy iframe#iframeGameHall');
        gameHallFrame = await gameHallEl.contentFrame();
        if (!gameHallFrame) throw new Error('Không lấy được contentFrame của iframe#iframeGameHall');

        await seamlessFrame.waitForSelector('iframe#iframeGame', { timeout: 90000, state: 'attached' });
        await page.waitForTimeout(1000);
        const gameEl = await seamlessFrame.$('iframe#iframeGame');
        if (!gameEl) throw new Error('Không tìm thấy iframe#iframeGame');
        gameCurrentFrame = await gameEl.contentFrame();
        if (!gameCurrentFrame) throw new Error('Không lấy được contentFrame của iframe#iframeGame');

        await scrollDownSlowly(logsNameProgress, page, 2000, 'CUỘN TRANG XUỐNG > TOÀN MÀN HÌNH GAME');
        await clickButtonNotifiGame(logsNameProgress, gameHallFrame, 'button.size-8.cursor-pointer.outline-none', 'TẮT THÔNG BÁO GAME SEXY');
        await helper.delay(5000);

        gameHallEl = await seamlessFrame.$('iframe#iframeGameHall');
        if (gameHallEl) {
            const f = await gameHallEl.contentFrame();
            if (f) gameHallFrame = f;
        }

        startCollectingResponses(page, [seamlessFrame, gameHallFrame, gameCurrentFrame]);
        await startBaccaratCycle(gameHallFrame, gameCurrentFrame);

        async function playBaccaratLoop(gh, gc) {
            try {
                await clickBaccaratTable(logsNameProgress, gh);
                await helper.delay(30000);
                await clickButtonOptional(logsNameProgress, gc, 'button#goHome2', 'TRỞ VỀ SẢNH GAME', 2);
                await helper.delay(2000);
            } catch (error) {
                await helper.appendToLog(`Lỗi trong chu kỳ baccarat: ${error.message}`, logsNameProgress);
                return resetMain();
            }
        }

        async function startBaccaratCycle(gh, gc) {
            const interval = 2 * (60 * 1000);
            while (true) {
                try {
                    await helper.appendToLog('Bắt đầu chu kỳ baccarat', logsNameProgress);
                    await playBaccaratLoop(gh, gc);
                    await helper.appendToLog('Chờ đến chu kỳ tiếp theo...', logsNameProgress);
                    await helper.delay(interval);
                } catch (error) {
                    await helper.appendToLog(`Lỗi trong startBaccaratCycle: ${error.message}`, logsNameProgress);
                    await resetMain();
                    break;
                }
            }
        }

        await helper.appendToLog('Log ended at ' + new Date().toISOString(), logsNameProgress);
        await helper.appendToLog('='.repeat(50), logsNameProgress);
    } catch (error) {
        await helper.appendToLog(`Error in main function: ${error.message}`, logsNameProgress);
        resetMain();
    }
}

async function sendSessionData(sessionId, nameService) {
    if (socket && sessionId !== undefined) {
        socket.emit('session', { sessionId, nameService, stampTime: helper.getCurrentTime().timeUnix });
        await helper.appendToLog(`(SOCKET) send server sessionId:: ${sessionId}`, logsNameProgress);
    }
}

async function getSessionFromCookies() {
    if (!context) return undefined;
    try {
        const cookies = await context.cookies();
        const sessionCookie = cookies.find(cookie => /JSESSIONID/i.test(cookie.name));
        return sessionCookie?.value;
    } catch (error) {
        await helper.appendToLog(`Không đọc được cookie session: ${error.message}`, logsNameProgress);
        return undefined;
    }
}

function startSessionCookiePolling() {
    if (sessionCookiePoller) clearInterval(sessionCookiePoller);
    sessionCookiePoller = setInterval(async () => {
        if (!isCollecting) return;
        const sessionId = await getSessionFromCookies();
        const timeUnixCurrent = helper.getCurrentTime().timeUnix;
        if (sessionId && timeUnixCurrent > (timeSendSessionNearest + timeSendSessionDelay)) {
            timeSendSessionNearest = timeUnixCurrent;
            await helper.appendToLog(`(COOKIE) found sessionId:: ${sessionId}`, logsNameProgress);
            sendSessionData(sessionId, nameServiceSocket);
        }
    }, 3000);
}

socket.on(`${nameServiceSocket}_restart`, async () => {
    await helper.appendToLog(`(SOCKET) - RESTART ${nameServiceSocket} - (SERVER)`, logsNameProgress);
    console.log(`(SOCKET) - RESTART ${nameServiceSocket}`);
    resetMain();
});

async function resetMain() {
    try {
        if (page) await page.close().catch(() => {});
        await helper.delay(10000);
    } catch (error) {
        console.error('Error during cleanup:', error.message);
    } finally {
        if (sessionCookiePoller) {
            clearInterval(sessionCookiePoller);
            sessionCookiePoller = undefined;
        }
        if (context) await context.close().catch(() => {});
        isCollecting = false;
        await helper.delay(5000);
        timeSendSessionNearest = helper.getCurrentTime().timeUnix;
        await helper.appendToLog('Khởi động lại chương trình...', logsNameProgress);
        await main().catch(async (err) => {
            await helper.appendToLog(`Lỗi khi khởi động lại main: ${err.message}`, logsNameProgress);
            await resetMain();
        });
    }
}

async function fillInput(logsNameProgress, target, classElement, value) {
    let retryCount = 0;
    while (retryCount <= 9) {
        try {
            const el = await target.$(classElement);
            if (el) {
                await el.fill(value);
                await helper.appendToLog(`NHẬP => ${value} THÀNH CÔNG`, logsNameProgress);
                return;
            }
        } catch (e) {}
        retryCount++;
        await helper.appendToLog(`NHẬP => ${value} THẤT BẠI (lần ${retryCount})`, logsNameProgress);
        await helper.delay(1000);
    }
    await helper.appendToLog(`Quá 9 lần nhập thất bại - khởi động lại`, logsNameProgress);
    await resetMain();
}

async function clickButton(logsNameProgress, target, classElement, msg = '_', numberClick = 1) {
    let retryCount = 0;
    const action = numberClick > 1 ? 'DOUBLE CLICK' : 'CLICK';
    while (retryCount <= 9) {
        await helper.delay(500);
        try {
            const el = await target.$(classElement);
            if (el) {
                await el.click({ clickCount: numberClick });
                await helper.appendToLog(`${action} => ${msg} THÀNH CÔNG`, logsNameProgress);
                return;
            }
        } catch (e) {}
        retryCount++;
        await helper.appendToLog(`${action} => ${msg} THẤT BẠI (lần ${retryCount})`, logsNameProgress);
        await helper.delay(2000);
    }
    await helper.appendToLog(`${action} => ${msg} THẤT BẠI QUÁ 9 LẦN - khởi động lại`, logsNameProgress);
    await resetMain();
}

async function clickButtonOptional(logsNameProgress, target, classElement, msg = '_', numberClick = 1) {
    const action = numberClick > 1 ? 'DOUBLE CLICK' : 'CLICK';
    for (let retryCount = 1; retryCount <= 3; retryCount++) {
        await helper.delay(500);
        try {
            const el = await target.$(classElement);
            if (el) {
                await el.click({ clickCount: numberClick });
                await helper.appendToLog(`${action} => ${msg} THÀNH CÔNG`, logsNameProgress);
                return true;
            }
        } catch (e) {}
        await helper.appendToLog(`${action} => ${msg} KHÔNG TÌM THẤY (lần ${retryCount}) - BỎ QUA`, logsNameProgress);
        await helper.delay(1000);
    }
    return false;
}

async function clickBaccaratTable(logsNameProgress, frame) {
    const selectors = [
        process.env.CLICK_IN_TABLE_GAME,
        'div.vue-recycle-scroller__item-view div.relative.cursor-pointer',
        'div.vue-recycle-scroller__item-view [class*="cursor-pointer"]',
        '.vue-recycle-scroller__item-view',
    ].filter(Boolean);

    for (const selector of selectors) {
        try {
            const elements = await frame.$$(selector);
            await helper.appendToLog(`CHECK SELECTOR BÀN => ${selector} | tìm thấy ${elements.length}`, logsNameProgress);
            for (let i = 0; i < Math.min(elements.length, 8); i++) {
                const el = elements[i];
                const visible = await el.isVisible().catch(() => false);
                if (!visible) continue;
                await el.scrollIntoViewIfNeeded().catch(() => {});
                try {
                    await el.click({ clickCount: 2, timeout: 5000 });
                } catch (error) {
                    await el.click({ timeout: 5000 });
                }
                await el.hover().catch(() => {});
                await helper.appendToLog(`DOUBLE CLICK => VÀO BÀN BACCARAT THÀNH CÔNG bằng selector ${selector} [${i}]`, logsNameProgress);
                return true;
            }
        } catch (error) {
            await helper.appendToLog(`CHECK SELECTOR BÀN LỖI => ${selector}: ${error.message}`, logsNameProgress);
        }
    }

    await dumpFrameDebug(logsNameProgress, frame, 'khong_tim_thay_ban_baccarat');
    throw new Error('Không tìm thấy selector vào bàn baccarat');
}

async function dumpFrameDebug(logsNameProgress, frame, name) {
    try {
        const dir = path.join(__dirname, 'debug');
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${name}-${Date.now()}.html`);
        const html = await frame.content();
        await fs.writeFile(filePath, html.slice(0, 500000), 'utf8');
        await helper.appendToLog(`DEBUG iframe HTML đã lưu: ${filePath}`, logsNameProgress);
    } catch (error) {
        await helper.appendToLog(`DEBUG iframe HTML lỗi: ${error.message}`, logsNameProgress);
    }
}

async function scrollDownSlowly(logsNameProgress, frame, duration = 2000, msg = 'SCROLL DOWN') {
    await helper.appendToLog(`CUỘN => ${msg}`, logsNameProgress);
    await frame.evaluate(({ d }) => {
        const scrollHeight = document.body.scrollHeight;
        const step = scrollHeight / (d / 16);
        let currentScroll = 0;
        function scroll() {
            if (currentScroll < scrollHeight) {
                window.scrollTo(0, currentScroll);
                currentScroll += step;
                requestAnimationFrame(scroll);
            }
        }
        scroll();
    }, { d: duration });
}

async function clickButtonNotifiGame(logsNameProgress, target, classElement, msg = '_', numberClick = 1) {
    const action = numberClick > 1 ? 'DOUBLE CLICK' : 'CLICK';
    let retryCount = 0;
    while (retryCount < 10) {
        retryCount++;
        await helper.delay(500);
        try {
            const el = await target.$(classElement);
            if (el) {
                await el.click({ clickCount: numberClick });
                await helper.appendToLog(`${action} => ${msg} THÀNH CÔNG (lần ${retryCount})`, logsNameProgress);
                return;
            }
        } catch (e) {}
        await helper.appendToLog(`${action} => ${msg} KHÔNG TÌM THẤY (lần ${retryCount})`, logsNameProgress);
        if (retryCount < 10) await helper.delay(2000);
    }
    await helper.appendToLog(`${action} => ${msg} ĐÃ THỬ 10 LẦN KHÔNG THÀNH CÔNG - BỎ QUA`, logsNameProgress);
}
