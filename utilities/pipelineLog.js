const { getCurrentTime } = require('./helper');

function pipelineLog(service, step, message, extra) {
    const prefix = `[${service || 'APP'}][${step}]`;
    const suffix = extra !== undefined
        ? ` | ${typeof extra === 'object' ? JSON.stringify(extra) : extra}`
        : '';
    console.log(`${getCurrentTime().timeFormatted} ${prefix} ${message}${suffix}`);
}

function explainInvalidSession(session) {
    const currentTime = getCurrentTime().timeUnix;
    if (!session) return 'session object missing';
    if (typeof session.nameService !== 'string' || session.nameService.trim() === '') {
        return 'missing nameService';
    }
    if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
        return 'missing sessionId';
    }
    if (typeof session.stampTime !== 'number' || session.stampTime <= 0) {
        return 'invalid stampTime';
    }
    const ageMs = currentTime - session.stampTime;
    if (ageMs >= 60 * 1000) {
        return `session expired (${Math.round(ageMs / 1000)}s old, max 60s)`;
    }
    return 'valid';
}

module.exports = {
    pipelineLog,
    explainInvalidSession,
};
