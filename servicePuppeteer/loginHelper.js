const fs = require('fs').promises;
const path = require('path');
const { delay } = require('../utilities/helper');

const LOGIN_OPEN_SELECTORS = [
    () => process.env.SHOW_DIALOG_LOGIN,
    () => '.header_btn_login',
    () => '.login_btn',
    () => '.btn_login',
    () => 'button.login',
    () => '.nav_item_btn.login',
    () => '.submit_btn',
].map((fn) => fn()).filter(Boolean);

const LOGIN_READY_SELECTORS = [
    () => process.env.INPUT_USERNAME_LOGIN,
    () => process.env.BASE64_CAPCHA,
    () => 'div.captcha_box img',
    () => '.username_input',
    () => '.captcha_input',
].map((fn) => fn()).filter(Boolean);

async function saveDebugScreenshot(page, label) {
    try {
        const dir = path.join(__dirname, 'debug');
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${label}-${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`[DEBUG] screenshot saved: ${file}`);
        return file;
    } catch (error) {
        console.log(`[DEBUG] screenshot failed: ${error.message}`);
        return null;
    }
}

async function getLoginPageState(page) {
    return page.evaluate((selectors) => {
        const pick = (selector) => {
            try {
                const node = document.querySelector(selector);
                if (!node) return false;
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            } catch (_) {
                return false;
            }
        };

        return {
            url: location.href,
            title: document.title,
            submitBtnCount: document.querySelectorAll('.submit_btn').length,
            captchaVisible: pick('div.captcha_box img'),
            usernameVisible: pick('.username_input'),
            passwordVisible: pick('.password_input'),
            captchaInputVisible: pick('.captcha_input'),
            modalCount: document.querySelectorAll('.publicModal, .tcg_modal, [class*="modal"]').length,
            selectors: selectors.map((selector) => ({ selector, visible: pick(selector) })),
        };
    }, LOGIN_READY_SELECTORS);
}

async function openLoginDialog(page, logStep) {
    logStep('STEP_04', 'open login dialog start', { selectors: LOGIN_OPEN_SELECTORS });

    for (const selector of LOGIN_OPEN_SELECTORS) {
        const button = await page.$(selector);
        if (!button) {
            logStep('STEP_04', 'login trigger not found', { selector });
            continue;
        }

        await button.evaluate((node) => node.click());
        logStep('STEP_04', 'login trigger clicked', { selector });
        await delay(2000);

        const ready = await waitForLoginDialog(page, logStep, 12000);
        if (ready) return true;
    }

    const state = await getLoginPageState(page);
    logStep('STEP_04', 'login dialog failed to open', state);
    await saveDebugScreenshot(page, 'login-dialog-fail');
    return false;
}

async function waitForLoginDialog(page, logStep, timeout = 15000) {
    for (const selector of LOGIN_READY_SELECTORS) {
        try {
            await page.waitForSelector(selector, { timeout, visible: true });
            logStep('STEP_04', 'login dialog ready', { selector });
            return true;
        } catch (_) {
            logStep('STEP_04', 'wait login selector timeout', { selector, timeout });
        }
    }

    const state = await getLoginPageState(page);
    logStep('STEP_04', 'login dialog not ready after wait', state);
    return false;
}

module.exports = {
    openLoginDialog,
    waitForLoginDialog,
    getLoginPageState,
    saveDebugScreenshot,
};
