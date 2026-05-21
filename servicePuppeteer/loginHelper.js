const fs = require('fs').promises;
const path = require('path');
const { delay } = require('../utilities/helper');

const LOGIN_OPEN_SELECTORS = [
    process.env.SHOW_DIALOG_LOGIN,
    '.header_btn_login',
    '.login_btn',
    '.btn_login',
    'button.login',
    '.submit_btn',
].filter(Boolean);

const LOGIN_READY_SELECTORS = [
    process.env.BASE64_CAPCHA,
    process.env.INPUT_USERNAME_LOGIN,
    'div.captcha_box img',
    '.username_input',
    '.captcha_input',
].filter(Boolean);

async function saveDebugScreenshot(page, label) {
    try {
        if (!page || page.isClosed()) return null;
        const dir = path.join(__dirname, 'debug');
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${label}-${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`[DEBUG] screenshot saved: ${file}`);
        return file;
    } catch (error) {
        console.log(`[DEBUG] screenshot failed: ${error.message}`);
        return null;
    }
}

async function getLoginPageState(page) {
    try {
        return await page.evaluate(() => ({
            url: location.href,
            captcha: !!document.querySelector('div.captcha_box img'),
            username: !!document.querySelector('.username_input'),
            submitBtnCount: document.querySelectorAll('.submit_btn').length,
        }));
    } catch (error) {
        return { error: error.message };
    }
}

async function waitAnySelector(page, selectors, timeout = 8000) {
    const tasks = selectors.map((selector) =>
        page.waitForSelector(selector, { timeout, visible: true }).then(() => selector)
    );

    try {
        return await Promise.any(tasks);
    } catch (_) {
        return null;
    }
}

async function openLoginDialog(page, logStep) {
    logStep('STEP_04', 'open login dialog start', {
        domain: process.env.DOMAIN,
        openSelectors: LOGIN_OPEN_SELECTORS,
        readySelectors: LOGIN_READY_SELECTORS,
    });

    const alreadyOpen = await waitAnySelector(page, LOGIN_READY_SELECTORS, 3000);
    if (alreadyOpen) {
        logStep('STEP_04', 'login dialog already open', { selector: alreadyOpen });
        return true;
    }

    for (const selector of LOGIN_OPEN_SELECTORS) {
        if (page.isClosed()) {
            throw new Error('Page closed before opening login dialog');
        }

        const button = await page.$(selector);
        if (!button) {
            logStep('STEP_04', 'login trigger not found', { selector });
            continue;
        }

        try {
            await button.click();
        } catch (_) {
            await button.evaluate((node) => node.click());
        }

        logStep('STEP_04', 'login trigger clicked', { selector });
        await delay(1500);

        const readySelector = await waitAnySelector(page, LOGIN_READY_SELECTORS, 8000);
        if (readySelector) {
            logStep('STEP_04', 'login dialog ready', { selector: readySelector });
            return true;
        }

        logStep('STEP_04', 'login dialog still closed after click', { selector });
    }

    const state = await getLoginPageState(page);
    logStep('STEP_04', 'login dialog failed to open', state);
    await saveDebugScreenshot(page, 'login-dialog-fail');
    return false;
}

module.exports = {
    openLoginDialog,
    getLoginPageState,
    saveDebugScreenshot,
};
