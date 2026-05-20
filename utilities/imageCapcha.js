const { clickButton } = require('../utilities/eventBot');
const { delay, appendToLog } = require('../utilities/helper');
const { createWorker } = require('tesseract.js');
const { Jimp } = require("jimp");
const fs = require('fs');
const path = require('path');
const IMAGE = {
    BEFORE: "image_before.jpg",
    AFTER: "image_after.jpg",
}

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

const MAX_CAPCHA_RETRY = 10;

async function getCodeCapchaLogin(logsNameProgress, page, retryCount = 0) {
    await appendToLog("BẮT ĐẦU LẤY ẢNH CAPCHA" + (retryCount > 0 ? ` (lần ${retryCount + 1})` : ""), logsNameProgress);
    await delay(retryCount === 0 ? 3000 : 2000);

    // Chờ captcha img xuất hiện
    try {
        if (page.waitForSelector) {
            await page.waitForSelector('div.captcha_box img', { timeout: 10000 }).catch(() => {});
        }
    } catch (_) {}

    const base64Image = await page.evaluate(() => {
        const img = document.querySelector('div.captcha_box img');
        return img ? img.getAttribute('src') || img.src : null;
    });

    if (!base64Image) {
        if (retryCount >= MAX_CAPCHA_RETRY) {
            await appendToLog("KHÔNG LẤY ĐƯỢC ẢNH CAPCHA SAU " + MAX_CAPCHA_RETRY + " LẦN", logsNameProgress);
            throw new Error("Không lấy được ảnh captcha sau " + MAX_CAPCHA_RETRY + " lần thử");
        }
        await appendToLog("KHÔNG LẤY ĐƯỢC ẢNH CAPCHA - THỬ LẠI", logsNameProgress);
        await delay(2000);
        return getCodeCapchaLogin(logsNameProgress, page, retryCount + 1);
    }
    await appendToLog("LẤY ẢNH CAPCHA THÀNH CÔNG", logsNameProgress)
    const codeCapcha = await handleCapchaBase64ToCode(base64Image)

    if (codeCapcha.code.length !== 4 || !codeCapcha.success) {
        await delay(500);
        await clickButton(logsNameProgress, page, '.captcha_box', 'LỖI GIẢI MÃ CAPCHA - ĐỔI MÃ CAPCHA KHÁC');
        return getCodeCapchaLogin(logsNameProgress, page)
    }
    await appendToLog(`GIẢI MÃ CAPCHA THÀNH CÔNG - ${codeCapcha.code}`, logsNameProgress)
    return codeCapcha.code;
}

module.exports = {
    handleCapchaBase64ToCode,
    getCodeCapchaLogin,
};