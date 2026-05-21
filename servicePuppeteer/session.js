const { firefox } = require('playwright');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const io = require('socket.io-client');
const fs = require('fs').promises;

const { request, imageCapcha, helper } = require('../utilities');
const { account_1: account } = require('./account.puppeteer');

const DOMAIN = process.env.DOMAIN || 'https://www.rr199.com';
const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';

let isCollecting = false;
let socket;
let context;
let page;
let seamlessFrame;
let gameHallFrame;
let gameCurrentFrame;
let lastNetworkHallSessionId;
let gklamNetworkHitCount = 0;
let timeSendSessionDelay = Number(account.timeSendSessionDelay);
let timeSendSessionNearest = helper.getCurrentTime().timeUnix;
const username_game = account.username_game;
const password_game = account.password_game;
const nameServiceSocket = account.nameServiceSocket;
const logsNameProgress = account.logsNameProgress;

main();
socket = io(`${process.env.SERVER_HOSTNAME}:${process.env.SERVER_PORT}`);
socket.on('connect', () => console.log('(SOCKET) Connecting'));
socket.on('disconnect', () => console.log('(SOCKET) Disconnected'));

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
        attachSessionCollector();

        await helper.appendToLog('BẮT ĐẦU CHƯƠNG TRÌNH FIREFOX - GHI LOGS', logsNameProgress);
        await helper.appendToLog('='.repeat(50), logsNameProgress);

        page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
        page.on('error', (err) => helper.appendToLog(`Page error: ${err.message}`, logsNameProgress));
        page.on('pageerror', (err) => {
            const msg = (err && err.message) ? err.message : String(err);
            if (/Firebase.*auth\/argument-error/i.test(msg)) return;
            helper.appendToLog(`Page uncaught exception: ${msg}`, logsNameProgress);
        });

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

        let gameHallEl = null;
        let gameEl = null;
        try {
            await seamlessFrame.waitForSelector('iframe#iframeGameHall', { timeout: 90000, state: 'attached' });
            await page.waitForTimeout(2000);
            gameHallEl = await seamlessFrame.$('iframe#iframeGameHall');
        } catch (e) {
            await helper.appendToLog('Timeout iframeGameHall - thử fallback childFrames', logsNameProgress);
        }
        if (gameHallEl) {
            gameHallFrame = await gameHallEl.contentFrame();
        }
        if (!gameHallFrame && seamlessFrame.childFrames) {
            const children = seamlessFrame.childFrames();
            if (children.length >= 1) gameHallFrame = children[0];
            if (children.length >= 2) gameCurrentFrame = children[1];
            if (gameHallFrame || gameCurrentFrame) await helper.appendToLog('Dùng fallback childFrames', logsNameProgress);
        }
        if (!gameHallFrame) throw new Error('Không tìm thấy iframeGameHall - trang có thể báo lỗi (status 1004)');

        if (!gameCurrentFrame) {
            try {
                await seamlessFrame.waitForSelector('iframe#iframeGame', { timeout: 30000, state: 'attached' });
                await page.waitForTimeout(1000);
                gameEl = await seamlessFrame.$('iframe#iframeGame');
                if (gameEl) gameCurrentFrame = await gameEl.contentFrame();
            } catch (e) {}
            if (!gameCurrentFrame && seamlessFrame.childFrames && seamlessFrame.childFrames().length >= 2) {
                gameCurrentFrame = seamlessFrame.childFrames()[1];
            }
        }
        if (!gameCurrentFrame) throw new Error('Không tìm thấy iframeGame - trang có thể báo lỗi');

        await scrollDownSlowly(logsNameProgress, page, 2000, 'CUỘN TRANG XUỐNG > TOÀN MÀN HÌNH GAME');
        await clickButtonNotifiGame(logsNameProgress, gameHallFrame, 'button.size-8.cursor-pointer.outline-none', 'TẮT THÔNG BÁO GAME SEXY');
        await helper.delay(5000);

        gameHallEl = await seamlessFrame.$('iframe#iframeGameHall');
        if (gameHallEl) {
            const f = await gameHallEl.contentFrame();
            if (f) gameHallFrame = f;
        }

        await logFrameSessionDebug('hall-ready');
        await pushGklamHallSessionRetry('hall-ready', 6, 5000);
        await startBaccaratCycle();

        async function refreshGameFrames() {
            if (!seamlessFrame) return { gh: gameHallFrame, gc: gameCurrentFrame };
            try {
                const gameHallEl = await seamlessFrame.$('iframe#iframeGameHall');
                if (gameHallEl) {
                    const f = await gameHallEl.contentFrame();
                    if (f) gameHallFrame = f;
                }
                const gameEl = await seamlessFrame.$('iframe#iframeGame');
                if (gameEl) {
                    const f = await gameEl.contentFrame();
                    if (f) gameCurrentFrame = f;
                }
            } catch (e) {}
            return { gh: gameHallFrame, gc: gameCurrentFrame };
        }

        async function playBaccaratLoop() {
            const { gh, gc } = await refreshGameFrames();
            const enteredTable = await clickButtonOptional(
                logsNameProgress, gh, process.env.CLICK_IN_TABLE_GAME, 'VÀO BÀN BACCARAT', 2, 10
            );
            if (enteredTable) {
                await gh.hover(process.env.CLICK_IN_TABLE_GAME).catch(() => {});
                await helper.delay(15000);
            }
            await pushGklamHallSessionRetry(enteredTable ? 'on-table' : 'in-hall', 12, 5000);
            await clickButtonOptional(logsNameProgress, gc, 'button#goHome2', 'TRỞ VỀ SẢNH GAME', 2);
            await helper.delay(2000);
        }

        async function startBaccaratCycle() {
            const interval = 2 * (60 * 1000);
            while (true) {
                await helper.appendToLog('Bắt đầu chu kỳ baccarat', logsNameProgress);
                await playBaccaratLoop();
                await helper.appendToLog('Chờ đến chu kỳ tiếp theo...', logsNameProgress);
                await helper.delay(interval);
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

function attachSessionCollector() {
    isCollecting = true;
    gklamNetworkHitCount = 0;
    context.on('response', onHallNetworkResponse);
    page.on('response', onHallNetworkResponse);
}

async function onHallNetworkResponse(response) {
    if (!isCollecting) return;
    try {
        const url = response.url();
        if (/gklam\.com|awamat\.com/i.test(url)) {
            gklamNetworkHitCount++;
            if (gklamNetworkHitCount <= 8) {
                await helper.appendToLog(`(NETWORK) gklam #${gklamNetworkHitCount}: ${url.slice(0, 140)}`, logsNameProgress);
            }
        }
    } catch (error) {}
    const resSession = await request.CollectingResponseSession(response, isCollecting);
    if (typeof resSession !== 'string' || !/^[a-zA-Z0-9]+$/.test(resSession)) return;
    lastNetworkHallSessionId = resSession;
    await tryEmitValidHallSession(`network:${resSession.slice(0, 8)}`);
}

async function extractSessionFromFrame(frame) {
    if (!frame) return undefined;
    try {
        const fromUrl = request.extractSessionIdFromUrl(frame.url());
        if (fromUrl) return fromUrl;
        const fromDom = await frame.evaluate(() => {
            const href = window.location.href;
            const urlMatch = href.match(/jsessionid[=;/]([^?&;\s]+)/i);
            if (urlMatch) return urlMatch[1];
            const cookieMatch = document.cookie.match(/JSESSIONID=([^;]+)/i);
            return cookieMatch ? cookieMatch[1] : null;
        }).catch(() => null);
        return fromDom || undefined;
    } catch (error) {
        return undefined;
    }
}

async function resolveHallSessionId() {
    if (lastNetworkHallSessionId) return lastNetworkHallSessionId;
    for (const frame of [gameCurrentFrame, gameHallFrame, seamlessFrame]) {
        const sessionId = await extractSessionFromFrame(frame);
        if (sessionId) {
            lastNetworkHallSessionId = sessionId;
            return sessionId;
        }
    }
    return await getGklamSessionFromCookies();
}

async function logFrameSessionDebug(label) {
    const frames = [
        ['seamless', seamlessFrame],
        ['gameHall', gameHallFrame],
        ['gameCurrent', gameCurrentFrame],
    ];
    for (const [name, frame] of frames) {
        if (!frame) continue;
        const url = frame.url();
        const sid = request.extractSessionIdFromUrl(url) || await extractSessionFromFrame(frame);
        await helper.appendToLog(`(DEBUG) ${label} ${name} url=${url.slice(0, 120)} session=${sid || 'none'}`, logsNameProgress);
        if (sid) lastNetworkHallSessionId = sid;
    }
    await helper.appendToLog(`(DEBUG) ${label} gklam network hits=${gklamNetworkHitCount}`, logsNameProgress);
}

async function tryEmitValidHallSession(source) {
    const sessionId = await resolveHallSessionId();
    if (!sessionId) return false;
    const data = await request.requestData(sessionId);
    const tableCount = Array.isArray(data?.tableItems) ? data.tableItems.length : 0;
    if (tableCount === 0) {
        await helper.appendToLog(`(SESSION) invalid tableItems=0 source=${source} id=${sessionId.slice(0, 8)}`, logsNameProgress);
        return false;
    }
    const timeUnixCurrent = helper.getCurrentTime().timeUnix;
    if (timeUnixCurrent <= (timeSendSessionNearest + timeSendSessionDelay)) return true;
    timeSendSessionNearest = timeUnixCurrent;
    await helper.appendToLog(`(SESSION) valid hall session tableItems=${tableCount} source=${source}`, logsNameProgress);
    sendSessionData(sessionId, nameServiceSocket);
    return true;
}

async function getGklamSessionFromCookies() {
    if (!context) return undefined;
    try {
        const probeUrls = [
            'https://vcnh2k.gklam.com',
            'https://gklam.com',
        ];
        const seen = new Map();
        for (const url of probeUrls) {
            const cookies = await context.cookies(url);
            for (const cookie of cookies) {
                if (/JSESSIONID/i.test(cookie.name)) seen.set(cookie.value, cookie);
            }
        }
        const allCookies = await context.cookies();
        for (const cookie of allCookies) {
            if (/JSESSIONID/i.test(cookie.name) && /gklam\.com/i.test(cookie.domain || '')) {
                seen.set(cookie.value, cookie);
            }
        }
        if (!seen.size) return undefined;
        return [...seen.keys()].pop();
    } catch (error) {
        await helper.appendToLog(`Không đọc được cookie gklam: ${error.message}`, logsNameProgress);
        return undefined;
    }
}

async function pushGklamHallSession(label = 'hall') {
    await logFrameSessionDebug(label);
    const ok = await tryEmitValidHallSession(label);
    if (!ok) {
        await helper.appendToLog(`(SESSION) chưa có hall session hợp lệ [${label}]`, logsNameProgress);
        return false;
    }
    return true;
}

async function pushGklamHallSessionRetry(label, attempts = 12, intervalMs = 5000) {
    for (let i = 1; i <= attempts; i++) {
        if (await pushGklamHallSession(`${label} ${i}/${attempts}`)) return true;
        if (i < attempts) await helper.delay(intervalMs);
    }
    await helper.appendToLog(`(SESSION) FAIL sau ${attempts} lần [${label}]`, logsNameProgress);
    return false;
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
        if (context) await context.close().catch(() => {});
        isCollecting = false;
        lastNetworkHallSessionId = undefined;
        gklamNetworkHitCount = 0;
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

async function clickButtonOptional(logsNameProgress, target, classElement, msg = '_', numberClick = 1, maxRetry = 3) {
    const action = numberClick > 1 ? 'DOUBLE CLICK' : 'CLICK';
    for (let retryCount = 1; retryCount <= maxRetry; retryCount++) {
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
    await helper.appendToLog(`${action} => ${msg} KHÔNG TÌM THẤY sau ${maxRetry} lần - BỎ QUA`, logsNameProgress);
    return false;
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
