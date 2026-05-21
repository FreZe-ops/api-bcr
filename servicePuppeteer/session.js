const puppeteer = require('puppeteer');
require('dotenv').config();
const io = require('socket.io-client');
const fs = require('fs').promises;
const path = require('path');

const { request, imageCapcha, helper } = require('../utilities');
const { pipelineLog } = require('../utilities/pipelineLog');
const { openLoginDialog } = require('./loginHelper');
const { account_1: account } = require('./account.puppeteer')

let isCollecting = false;
let socket;
let browser;
let page;
let seamlessFrame;
let gameHallFrame;
let gameCurrentFrame;
let timeSendSessionDelay = Number(account.timeSendSessionDelay);
let timeSendSessionNearest = helper.getCurrentTime().timeUnix;
const username_game = account.username_game;
const password_game = account.password_game;
const nameServiceSocket = account.nameServiceSocket;
const logsNameProgress = account.logsNameProgress;
const logStep = (step, message, extra) => pipelineLog(nameServiceSocket, step, message, extra);

main()
socket = io(`${process.env.SERVER_HOSTNAME}:${process.env.SERVER_PORT}`);
socket.on('connect', () => logStep('STEP_00', 'socket connected', { id: socket.id, url: `${process.env.SERVER_HOSTNAME}:${process.env.SERVER_PORT}` }));
socket.on('disconnect', () => logStep('STEP_00', 'socket disconnected'));
socket.on('connect_error', (err) => logStep('STEP_00', 'socket connect_error', err.message));

async function main() {
    try {
        logStep('STEP_01', 'launch browser start', { userDataDir: account.userDataDir });
        browser = await puppeteer.launch({
            headless: 'new',
            protocolTimeout: 300000,
            userDataDir: `./servicePuppeteer/dataDir/${account.userDataDir}`,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=IsolateOrigins,site-per-process',
            ]
        });
        page = await browser.newPage();
        const width = 1920;
        const height = 1080;
        await page.setViewport({ width, height });
        await page.setUserAgent(process.env.USER_AGENT);
        logStep('STEP_01', 'browser ready', { viewport: { width, height }, domain: process.env.DOMAIN });

        await helper.appendToLog('BẮT ĐẦU CHƯƠNG TRÌNH - GHI LOGS', logsNameProgress);
        await helper.appendToLog('='.repeat(50), logsNameProgress);

        page.on('error', async err => {
            logStep('STEP_ERR', 'page error', err.message);
            await helper.appendToLog(`Page error: ${err.message}`, logsNameProgress);
        });

        page.on('pageerror', async err => {
            const msg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
            logStep('STEP_ERR', 'page uncaught exception', msg);
            await helper.appendToLog(`Page uncaught exception : ${msg}`, logsNameProgress);
        });

        function startCollectingResponses(page, frames = []) {
            isCollecting = true;
            logStep('STEP_13', 'start collecting network responses', { frameCount: frames.length });
            const handleResponse = async (response) => {
                const resSession = await request.CollectingResponseSession(response, isCollecting, nameServiceSocket);
                const timeUnixCurrent = helper.getCurrentTime().timeUnix;

                if (typeof resSession === 'string' && /^[a-zA-Z0-9]+$/.test(resSession)) {
                    if (timeUnixCurrent > (timeSendSessionNearest + timeSendSessionDelay)) {
                        timeSendSessionNearest = timeUnixCurrent;
                        sendSessionData(resSession, nameServiceSocket);
                    } else {
                        logStep('STEP_14', 'session captured but throttled', {
                            sessionId: resSession.slice(0, 12),
                            waitMs: (timeSendSessionNearest + timeSendSessionDelay) - timeUnixCurrent,
                        });
                    }
                }
            };

            // Gắn listener cho page và tất cả các frame
            page.on('response', handleResponse);
            frames.forEach(frame => {
                frame.on('response', handleResponse);
            });
        }

        logStep('STEP_02', 'goto domain start', process.env.DOMAIN);
        await page.goto(process.env.DOMAIN, { waitUntil: 'domcontentloaded', timeout: 120000 });
        logStep('STEP_02', 'goto domain OK', page.url());

        // login
        logStep('STEP_03', 'login flow start');
        await clickButtonOptional(logsNameProgress, page, process.env.CLOSE_DIALOG_WELCOME, 'ĐÓNG THÔNG BÁO SỰ KIỆN');
        await helper.delay(1000);

        const loginOpened = await openLoginDialog(page, logStep);
        if (!loginOpened) {
            throw new Error('Không mở được dialog đăng nhập — kiểm tra selector SHOW_DIALOG_LOGIN trong .env');
        }

        logStep('STEP_05', 'captcha start');
        const codeCapcha = await imageCapcha.getCodeCapchaLogin(logsNameProgress, page)
        logStep('STEP_05', 'captcha OK', codeCapcha);
        await fillInput(logsNameProgress, page, process.env.INPUT_USERNAME_LOGIN, username_game);
        await fillInput(logsNameProgress, page, process.env.INPUT_PASSWORD_LOGIN, password_game);
        await fillInput(logsNameProgress, page, process.env.INPUT_CAPCHA_LOGIN, codeCapcha);
        await clickButton(logsNameProgress, page, 'button[type="submit"].submit_btn', 'ĐĂNG NHẬP');
        logStep('STEP_06', 'login submitted');
        await helper.delay(5000);
        await clickButtonOptional(logsNameProgress, page, process.env.SHOW_DIALOG_LOGIN_SUCCESS, 'ĐÓNG THÔNG BÁO CẢNH BÁO KHI HOÀN TẤT ĐĂNG NHẬP');
        logStep('STEP_07', 'login flow done');

        // redirect to baccarat sexy
        await helper.delay(1000);
        logStep('STEP_08', 'navigate to game sexy menu');
        await clickButton(logsNameProgress, page, 'div.header_nav_list div.nav_item:nth-child(2) div.nav_item_btn.LIVE div.name1', 'VÀO MENU GAME SEXY');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 });
        logStep('STEP_08', 'game sexy menu loaded', page.url());
        await helper.delay(1000);
        await scrollDownSlowly(logsNameProgress, page, 1000, 'CUỘN XUỐNG - TÌM NÚT BUTTON VÀO GAME');
        await helper.delay(1000);
        await clickButton(logsNameProgress, page, '.play-btn', 'VÀO SẢNH SEXY');
        logStep('STEP_09', 'enter game hall clicked, waiting 20s');
        await helper.delay(20000);

        // iframe SEXY GAME
        logStep('STEP_10', 'wait iframe#seamless-game');
        await page.waitForFunction(
            () => !!document.querySelector('iframe#seamless-game'),
            { timeout: 60000, polling: 'mutation' }
        );
        const seamlessFrameElement = await page.$('iframe#seamless-game');
        seamlessFrame = await seamlessFrameElement.contentFrame();
        logStep('STEP_10', 'iframe#seamless-game ready');

        // iframe GAME HALL
        logStep('STEP_11', 'wait iframe#iframeGameHall');
        await seamlessFrame.waitForFunction(
            () => !!document.querySelector('iframe#iframeGameHall'),
            { timeout: 60000, polling: 'mutation' }
        );
        let gameHallFrameElement = await seamlessFrame.$('iframe#iframeGameHall');
        gameHallFrame = await gameHallFrameElement.contentFrame();
        logStep('STEP_11', 'iframe#iframeGameHall ready');

        // iframe GAME
        logStep('STEP_12', 'wait iframe#iframeGame');
        await seamlessFrame.waitForFunction(
            () => !!document.querySelector('iframe#iframeGame'),
            { timeout: 60000, polling: 'mutation' }
        );
        let gameCurrentFrameElement = await seamlessFrame.$('iframe#iframeGame');
        gameCurrentFrame = await gameCurrentFrameElement.contentFrame();
        logStep('STEP_12', 'iframe#iframeGame ready');

        await scrollDownSlowly(logsNameProgress, page, 2000, 'CUỘN TRANG XUỐNG > TOÀN MÀN HÌNH GAME');
        await clickButtonNotifiGame(logsNameProgress, gameHallFrame, 'button.size-8.cursor-pointer.outline-none', 'TẮT THÔNG BÁO GAME SEXY');
        await helper.delay(5000);

        gameHallFrameElement = await seamlessFrame.$('iframe#iframeGameHall');
        gameHallFrame = await gameHallFrameElement.contentFrame();

        // lấy session
        startCollectingResponses(page, [seamlessFrame, gameHallFrame, gameCurrentFrame]);
        logStep('STEP_15', 'enter baccarat cycle');

        // duy trì seesion game
        await startBaccaratCycle(gameHallFrame, gameCurrentFrame);

        // Vào ra bàn game baccarat
        async function playBaccaratLoop(gameHallFrame, gameCurrentFrame) {
            try {
                await clickButton(logsNameProgress, gameHallFrame, process.env.CLICK_IN_TABLE_GAME, 'VÀO BÀN BACCARAT', 2);
                await gameHallFrame.hover(process.env.CLICK_IN_TABLE_GAME);
                await helper.delay(30000);

                await clickButton(logsNameProgress, gameCurrentFrame, 'button#goHome2', 'TRỞ VỀ SẢNH GAME', 2);
                await helper.delay(2000);
            } catch (error) {
                await helper.appendToLog(`Lỗi trong chu kỳ baccarat: ${error.message}`, logsNameProgress);
                return resetMain()
            }
        }

        // lặp lại vô hạn
        async function startBaccaratCycle(gameHallFrame, gameCurrentFrame) {
            const interval = 2 * (60 * 1000);
            while (true) {
                try {
                    await helper.appendToLog('Bắt đầu chu kỳ baccarat', logsNameProgress);
                    await playBaccaratLoop(gameHallFrame, gameCurrentFrame);
                    await helper.appendToLog('Chờ đến chu kỳ tiếp theo...', logsNameProgress);
                    await new Promise(resolve => setTimeout(resolve, interval));
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
        logStep('STEP_ERR', 'main function error', { message: error.message, stack: error.stack?.split('\n')[0] });
        await helper.appendToLog(`Error in main function: ${error.message}`, logsNameProgress);
        resetMain();
    }
}

async function sendSessionData(sessionId, nameService) {
    if (!socket?.connected) {
        logStep('STEP_14', 'socket not connected, cannot emit session', { sessionId: sessionId?.slice(0, 12) });
        return;
    }
    if (sessionId !== undefined) {
        socket.emit('session', { sessionId, nameService, stampTime: helper.getCurrentTime().timeUnix });
        logStep('STEP_14', 'emit session to server', { sessionId: sessionId.slice(0, 12), nameService });
        await helper.appendToLog(`(SOCKET) send server sessionId:: ${sessionId}`, logsNameProgress);
    }
}

socket.on(`${nameServiceSocket}_restart`, async (data) => {
    await helper.appendToLog(`(SOCKET) - RESTART ${nameServiceSocket} - (SERVER)`, logsNameProgress);
    console.log(`(SOCKET) - RESTART ${nameServiceSocket}`)
    resetMain()
});

async function resetMain() {
    try {
        await clearListeners(page, [seamlessFrame, gameHallFrame, gameCurrentFrame]);
        if (gameCurrentFrame) await gameCurrentFrame.close().catch(() => {});
        if (gameHallFrame) await gameHallFrame.close().catch(() => {});
        if (seamlessFrame) await seamlessFrame.close().catch(() => {});
        if (page) await page.close().catch(() => {});
        await helper.delay(10000);

        // xoá chrome cũ
        // const folderPath = path.join(__dirname, 'dataDir', account.userDataDir);
        // await fs.rm(folderPath, { recursive: true, force: true });
    } catch (error) {
        console.error('Error during cleanup:', error.message);
    } finally {
        if (browser) await browser.close().catch(() => {});
        isCollecting = false;
        await helper.delay(5000);
        timeSendSessionNearest = helper.getCurrentTime().timeUnix;
        await helper.appendToLog('Khởi động lại chương trình...', logsNameProgress);
        await main().catch(async err => {
            await helper.appendToLog(`Lỗi khi khởi động lại main: ${err.message}`, logsNameProgress);
            await resetMain();
        });
    }
}

async function clearListeners(page, frames = []) {
    try {
        if (page) {
            await page.removeAllListeners();
        }
        for (const frame of frames) {
            if (frame) {
                await frame.removeAllListeners();
            }
        }
    } catch (error) {
        console.error('Error clearing listeners:', error.message);
    }
}

// event bot
async function fillInput(logsNameProgress, page, classElement, value) {
    let retryCount = 0;

    while (retryCount <= 9) {
        const inputField = await page.$(classElement);
        if (inputField) {
            await inputField.type(value);
            await helper.appendToLog(`NHẬP => ${value} THÀNH CÔNG`, logsNameProgress);
            return;
        } else {
            retryCount++;
            await helper.appendToLog(`NHẬP => ${value} THẤT BẠI (lần ${retryCount})`, logsNameProgress);
            await helper.delay(1000);
        }
    }

    await helper.appendToLog(`Quá 9 lần nhập thất bại - khởi động lại`, logsNameProgress);
    await resetMain();
}

async function clickButtonOptional(logsNameProgress, page, classElement, msg = '_', maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (!page || page.isClosed()) {
            throw new Error(`Page closed during optional click: ${msg}`);
        }

        await helper.delay(500);
        const clickBtn = await page.$(classElement);
        if (clickBtn) {
            try {
                await clickBtn.click();
            } catch (_) {
                await clickBtn.evaluate((node) => node.click());
            }
            logStep('STEP_UI', 'optional click OK', { msg, selector: classElement, attempt });
            await helper.appendToLog(`CLICK => ${msg} THÀNH CÔNG`, logsNameProgress);
            return true;
        }
        logStep('STEP_UI', 'optional click not found', { msg, selector: classElement, attempt });
    }
    logStep('STEP_UI', 'optional click skipped', { msg, selector: classElement });
    await helper.appendToLog(`CLICK => ${msg} KHÔNG CÓ - BỎ QUA`, logsNameProgress);
    return false;
}

async function clickButton(logsNameProgress, page, classElement, msg = "_", numberClick = 1) {
    let retryCount = 0;
    const action = numberClick > 1 ? 'DOUBLE CLICK' : 'CLICK';

    while (retryCount <= 9) {
        await helper.delay(500);
        const clickBtn = await page.$(classElement);

        if (clickBtn) {
            await clickBtn.evaluate(b => b.click());
            await helper.appendToLog(`${action} => ${msg} THÀNH CÔNG`, logsNameProgress);
            return;
        } else {
            retryCount++;
            logStep('STEP_UI', `${action} fail`, { msg, selector: classElement, attempt: retryCount });
            await helper.appendToLog(`${action} => ${msg} THẤT BẠI (lần ${retryCount})`, logsNameProgress);
            await helper.delay(2000);
        }
    }

    await helper.appendToLog(`${action} => ${msg} THẤT BẠI QUÁ 9 LẦN - khởi động lại`, logsNameProgress);
    await resetMain();
}


async function scrollDownSlowly(logsNameProgress, frame, duration = 2000, msg = 'SCROLL DOWN') {
    await helper.appendToLog(`CUỘN => ${msg}`, logsNameProgress);
    await frame.evaluate((duration) => {
        const scrollHeight = document.body.scrollHeight;
        const step = scrollHeight / (duration / 16);
        let currentScroll = 0;

        function scroll() {
            if (currentScroll < scrollHeight) {
                window.scrollTo(0, currentScroll);
                currentScroll += step;
                requestAnimationFrame(scroll);
            }
        }
        scroll();
    }, duration);
}

async function clickButtonNotifiGame(logsNameProgress, page, classElement, msg = "_", numberClick = 1) {
    const action = numberClick > 1 ? 'DOUBLE CLICK' : 'CLICK';
    let retryCount = 0;
    const maxRetries = 10; // Tối đa 10 lần thử
    
    while (retryCount < maxRetries) {
        retryCount++;
        await helper.delay(500); // Chờ 0.5s giữa các lần thử
        
        const clickBtn = await page.$(classElement);
        
        if (clickBtn) {
            try {
                await clickBtn.evaluate(b => b.click());
                await helper.appendToLog(`${action} => ${msg} THÀNH CÔNG (lần ${retryCount})`, logsNameProgress);
                return; // Thành công thì thoát hàm
            } catch (error) {
                await helper.appendToLog(`${action} => ${msg} LỖI KHI CLICK (lần ${retryCount}): ${error.message}`, logsNameProgress);
            }
        } else {
            await helper.appendToLog(`${action} => ${msg} KHÔNG TÌM THẤY PHẦN TỬ (lần ${retryCount})`, logsNameProgress);
        }
        
        if (retryCount < maxRetries) {
            await helper.delay(2000); // Chờ 2s trước khi thử lại
        }
    }
    
    // Nếu chạy đến đây nghĩa là đã thử 10 lần không thành công
    await helper.appendToLog(`${action} => ${msg} ĐÃ THỬ 10 LẦN KHÔNG THÀNH CÔNG - BỎ QUA`, logsNameProgress);
}