const { clickButton } = require('../utilities/eventBot');
const { delay, appendToLog } = require('../utilities/helper');
const { createWorker } = require('tesseract.js');
const { Jimp } = require("jimp");
const fs = require('fs');
const path = require('path');
const { saveDebugScreenshot } = require('../servicePuppeteer/loginHelper');

const IMAGE = {
    BEFORE: "image_before.jpg",
    AFTER: "image_after.jpg",
}

const MAX_CAPTCHA_RETRY = 10;
const CAPTCHA_SELECTOR = process.env.BASE64_CAPCHA || 'div.captcha_box img';

async function handleCapchaBase64ToCode(base64Image) {
    try {
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(path.join(__dirname, 'image_temp', IMAGE.BEFORE), Buffer.from(base64Data, 'base64'));

        const img = await Jimp.read(path.join(__dirname, 'image_temp', IMAGE.BEFORE));
        await img
            .greyscale()
            .contrast(1)
            .normalize()
            .blur(1)
            .threshold({ max: 128, autoGreyscale: false })
            .invert()
            .write(path.join(__dirname, 'image_temp', IMAGE.AFTER));

        const worker = await createWorker('eng');
        let { data: { text } } = await worker.recognize(path.join(__dirname, 'image_temp', IMAGE.AFTER));
        await worker.terminate();
        text = text.replace(/[^\d]/g, '');
        return { success: true, code: text };
    } catch (error) {
        console.error('Lỗi:', error);
        return { success: false, code: undefined };
    }
}

async function getCodeCapchaLogin(logsNameProgress, page, retryCount = 0) {
    await appendToLog("BẮT ĐẦU LẤY ẢNH CAPCHA" + (retryCount > 0 ? ` (lần ${retryCount + 1})` : ""), logsNameProgress);
    await delay(retryCount === 0 ? 3000 : 2000);

    try {
        await page.waitForSelector(CAPTCHA_SELECTOR, { timeout: 10000, visible: true });
    } catch (error) {
        console.log(`[CAPTCHA][STEP_05] wait selector timeout | selector=${CAPTCHA_SELECTOR} | attempt=${retryCount + 1}`);
    }

    const base64Image = await page.evaluate((selector) => {
        const img = document.querySelector(selector);
        return img ? (img.getAttribute('src') || img.src) : null;
    }, CAPTCHA_SELECTOR);

    if (!base64Image) {
        const pageState = await page.evaluate(() => ({
            captchaBox: !!document.querySelector('.captcha_box'),
            captchaImg: !!document.querySelector('div.captcha_box img'),
            username: !!document.querySelector('.username_input'),
            url: location.href,
        }));
        console.log(`[CAPTCHA][STEP_05] no captcha img | attempt=${retryCount + 1} | state=${JSON.stringify(pageState)}`);

        if (retryCount >= MAX_CAPTCHA_RETRY) {
            await appendToLog(`KHÔNG LẤY ĐƯỢC ẢNH CAPCHA SAU ${MAX_CAPTCHA_RETRY} LẦN`, logsNameProgress);
            await saveDebugScreenshot(page, 'captcha-fail');
            throw new Error(`Không lấy được captcha sau ${MAX_CAPTCHA_RETRY} lần — login dialog có thể chưa mở`);
        }

        await appendToLog("KHÔNG LẤY ĐƯỢC ẢNH CAPCHA - THỬ LẠI", logsNameProgress);
        await delay(2000);
        return getCodeCapchaLogin(logsNameProgress, page, retryCount + 1);
    }

    await appendToLog("LẤY ẢNH CAPCHA THÀNH CÔNG", logsNameProgress);
    console.log(`[CAPTCHA][STEP_05] captcha img captured | length=${base64Image.length} | attempt=${retryCount + 1}`);
    const codeCapcha = await handleCapchaBase64ToCode(base64Image);

    if (codeCapcha.code.length !== 4 || !codeCapcha.success) {
        console.log(`[CAPTCHA][STEP_05] OCR fail | code=${codeCapcha.code} | success=${codeCapcha.success}`);
        await delay(500);
        await clickButton(logsNameProgress, page, '.captcha_box', 'LỖI GIẢI MÃ CAPCHA - ĐỔI MÃ CAPCHA KHÁC');
        return getCodeCapchaLogin(logsNameProgress, page, retryCount + 1);
    }

    await appendToLog(`GIẢI MÃ CAPCHA THÀNH CÔNG - ${codeCapcha.code}`, logsNameProgress);
    return codeCapcha.code;
}

module.exports = {
    handleCapchaBase64ToCode,
    getCodeCapchaLogin,
};
