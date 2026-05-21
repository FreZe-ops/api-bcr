const axios = require('axios');
require('dotenv').config();

const { getCurrentTime } = require('./helper');

async function requestData(sessionId) {
    const url = process.env.URI_REQUEST_DATA + sessionId;

    const headers = {
        "accept-language": "vi-VN,vi;q=0.9",
        "accept": "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    };

    const payload = new URLSearchParams();
    payload.append('gameGroupId', 2);

    try {
        const response = await axios.post(url, payload, { headers });
        const tableCount = Array.isArray(response.data?.tableItems) ? response.data.tableItems.length : 0;
        console.log(`[REQUEST_DATA] status=${response.status} tableItems=${tableCount} session=${sessionId.slice(0, 8)}...`);
        if (tableCount === 0) {
            const body = response.data && typeof response.data === 'object' ? response.data : {};
            console.warn('[REQUEST_DATA] empty hall — wrong jsessionid or session expired', {
                keys: Object.keys(body),
                status: body.status ?? body.errorCode ?? body.code,
                message: body.message ?? body.msg ?? body.errorMessage,
            });
        }
        return response.data;
    } catch (error) {
        console.error('[REQUEST_DATA] Error calling API:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
        });
        return {};
    }
}

async function CollectingResponseSession(response, isCollecting) {
    if (!isCollecting) return;

    const url = response.url();
    const status = response.status();
    const request = response.request();
    const resourceType = request.resourceType();
    try {
        const urlMatchDomains = ['bfscg.awamat.com', 'gklam.com', 'vcnh2k.gklam.com'];
        const urlMatches = urlMatchDomains.some(d => url.includes(d));
        const allowedTypes = ['xhr', 'fetch', 'document', 'script', 'other', 'websocket'];
        if (urlMatches && allowedTypes.includes(resourceType)) {
            let sessionId = undefined;
            const urlMatch = url.match(/jsessionid[=;/]([^?&;\s]+)/i);
            if (urlMatch) sessionId = urlMatch[1];
            const isHallQuery = /queryInitWebGameHall/i.test(url);
            if (!sessionId) {
                const headers = request.headers();
                const cookieHeader = headers['cookie'] || headers['Cookie'] || '';
                const cookieMatch = cookieHeader.match(/JSESSIONID=([^;]+)/i);
                if (cookieMatch) sessionId = cookieMatch[1];
            }
            if (!sessionId) {
                const headers = response.headers();
                const setCookieHeader = headers['set-cookie'] || headers['Set-Cookie'] || '';
                const cookieMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/i);
                if (cookieMatch) sessionId = cookieMatch[1];
            }
            if (sessionId) {
                const tag = isHallQuery ? 'HALL' : 'network';
                console.log(`[SESSION/${tag}] Found sessionId: ${sessionId} from URL: ${url}`);
            }
            return sessionId || undefined;
        }
    } catch (error) {
        console.error('[ERROR] CollectingResponseSession:', error.message)
        return undefined
    }
    return undefined
}

async function CollectingResponseSessionV2(response, isCollecting) {
    if (!isCollecting) return;

    const url = response.url();
    const status = response.status();
    const request = response.request();
    const resourceType = request.resourceType();

    try {
        console.log(`[DEBUG] Response: ${resourceType} - ${url}`);
        if ((resourceType === 'xhr' || resourceType === 'fetch') && url.includes('bfscg.baplaweb.com')) {
        // Lấy headers từ request thay vì từ URL
        const headers = request.headers();
        const cookieHeader = headers['cookie'] || headers['Cookie'];
            
            let sessionId = undefined;
            
            if (cookieHeader) {
                // Tìm JSESSIONID trong cookie header
                const jsessionidMatch = cookieHeader.match(/JSESSIONID=([^;]+)/);
                sessionId = jsessionidMatch ? jsessionidMatch[1] : undefined;
                
                if (sessionId) {
                    console.log(`[SESSION] Found sessionId: ${sessionId} from Request Headers`);
                    console.log(`[COOKIE] Full cookie: ${cookieHeader}`);
                    return sessionId;
                }
            }
            
            // Nếu không tìm thấy trong cookie, thử tìm trong URL (fallback)
            const urlMatch = url.match(/jsessionid=([^?]+)/i);
            sessionId = urlMatch ? urlMatch[1] : undefined;
            
            if (sessionId) {
                console.log(`[SESSION] Found sessionId: ${sessionId} from URL`);
                return sessionId;
            }
            
            console.log(`[SESSION] No sessionId found for URL: ${url}`);
            return undefined;
        }
    } catch (error) {
        console.error('[ERROR] CollectingResponseSession:', error.message)
        return undefined;
    }
    return undefined;
}



async function callQueryInitWebGameHall(sessionId) {
    const url = process.env.URI_REQUEST_DATA + sessionId;

    const headers = {
        "accept-language": "vi-VN,vi;q=0.9",
        "accept": "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    };

    const payload = new URLSearchParams();
    payload.append('gameGroupId', 2);

    try {
        const response = await axios.post(url, payload, { headers });
        return response.data;
    } catch (error) {
        console.error('Error calling API:', error.message);
        return null;
    }
}

async function sendTelegramMessage(token, idRecipient, message) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        await axios.post(url, { chat_id: idRecipient, text: message });
    } catch (err) {
        console.error('Lỗi khi gửi Telegram:', err.response?.data || err.message);
    }
}

module.exports = {
    callQueryInitWebGameHall,
    CollectingResponseSession,
    CollectingResponseSessionV2,
    sendTelegramMessage,
    requestData,
};