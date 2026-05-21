const axios = require('axios');
const express = require('express')
const app = express()
require('dotenv').config()
const http = require('http')
const server = http.createServer(app)
const socketIO = require('socket.io')
const cors = require('cors')
const { exec } = require('child_process');

const { getCurrentTime, isValidSession, appendToLog } = require('./utilities/helper');
const { pipelineLog, explainInvalidSession } = require('./utilities/pipelineLog');
const { filterData, initDatabase, checkAndUpdateDatabase } = require('./utilities/helperGameSexy');
const { sendTelegramMessage, requestData } = require('./utilities/request');
const { connect } = require('./config/mongo');
const router = require('./routers/index');
const { SESSION_LIST } = require('./config/predictResult.config')
const PORT = process.env.SERVER_PORT || 3201

app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
connect()
router(app)

const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

let sessionList = SESSION_LIST

io.on('connection', (socket) => {
    console.info(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S0] socket connected: ${socket.id}`);
    socket.on('session', async (payload) => {
        const { sessionId, nameService, stampTime } = payload
        console.info(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S1] received session payload`, {
            nameService,
            sessionId: sessionId?.slice(0, 12),
            stampTime,
        });

        if (sessionList.session.hasOwnProperty(nameService)) {
            sessionList.session[nameService] = {
                nameService,
                sessionId,
                stampTime: stampTime // || Date.now()
            };
            console.info(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S1] session stored => ${nameService} = ${sessionId?.slice(0, 12)}...`);
        } else {
            console.warn(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S1] ignored unknown service: ${nameService || '_'}`);
        }

        if (nameService == "NS5") {
            sessionList.sessionFailover.nameService = nameService
            sessionList.sessionFailover.sessionId = sessionId
            sessionList.sessionFailover.stampTime = stampTime
            // console.info(`${getCurrentTime().timeFormatted} - ${nameService} = ${sessionId} - SESSION FAILOVER`);
        }
    })
});

// thời gian khởi động lại service là 8 phút
setInterval(async () => {
    try {
        const timeUnixCurrent = getCurrentTime().timeUnix;

        for (const key in sessionList.session) {
            const session = sessionList.session[key];
            if (session.stampTime > 0 && (timeUnixCurrent - session.stampTime > ((60 * 1000) * 10))) {
                await appendToLog(`${session.nameService || key} | QUÁ 10 PHÚT CHƯA ĐƯỢC CẬP NHẬT - YÊU CẦU KHỞI ĐỘNG LẠI`, process.env.LOGS_SERVER_SEXY)
                if (session.nameService) {
                    const staleServiceName = session.nameService;
                    let cmdReloadPm2;

                    sessionList.session[key] = {
                        ...session,
                        nameService: undefined,
                        sessionId: undefined,
                        stampTime: -1,
                    };
                    // io.emit(`${session.nameService}_restart`, {});
                    // console.log(`ĐÃ GỬI YÊU CẦU KHỞI ĐỘNG LẠI => ${session.nameService}`);
                    // let cmdReloadPm2 = `pm2 reload ${session.namePm2}`
                    switch (staleServiceName) {
                        case 'NS1':
                            cmdReloadPm2 = 'pm2 reload session_sexy_1'
                            break;
                        case 'NS2':
                            cmdReloadPm2 = 'pm2 reload session_sexy_2'
                            break;
                        case 'NS3':
                            cmdReloadPm2 = 'pm2 reload session_sexy_3'
                            break;
                    }
                    if (!cmdReloadPm2) {
                        await appendToLog(`Không tìm thấy PM2 process cho service => ${staleServiceName}`, process.env.LOGS_SERVER_SEXY)
                        continue;
                    }
                    exec(cmdReloadPm2, async (error, stdout, stderr) => {
                        if (error) {
                            await appendToLog(`Lỗi khi reload PM2: ${error.message}`, process.env.LOGS_SERVER_SEXY)
                            return;
                        }
                        if (stderr) {
                            console.error(`stderr: ${stderr}`);
                            return;
                        }
                        await appendToLog(`stdout: ${stdout}`, process.env.LOGS_SERVER_SEXY)
                        await appendToLog(`(PM2)KHỞI ĐỘNG LẠI SERVICE => ${staleServiceName}`, process.env.LOGS_SERVER_SEXY)
                    });
                }
            }
        }
    } catch (error) {
        await appendToLog(`restart service: ${error}`, process.env.LOGS_SERVER_SEXY)
    }
}, 5000);

setInterval(async () => {
    const sessionKeys = Object.keys(sessionList.session);
    let availableSessions = sessionKeys
        .filter(key => isValidSession(sessionList.session[key]))
        .map(key => sessionList.session[key]);

    if (availableSessions.length === 0) {
        const pool = sessionKeys.map((key) => {
            const item = sessionList.session[key];
            return {
                key,
                nameService: item.nameService,
                sessionId: item.sessionId ? `${item.sessionId.slice(0, 8)}...` : null,
                stampTime: item.stampTime,
                reason: explainInvalidSession(item),
            };
        });
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S0] no valid session | pool=${JSON.stringify(pool)}`);
    } else {
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S0] valid sessions=${availableSessions.length}`, availableSessions.map(s => ({
            nameService: s.nameService,
            sessionId: s.sessionId?.slice(0, 8),
        })));
    }

    if (availableSessions.length === 0 && sessionList.sessionFailover.nameService) {
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S0] using failover session ${sessionList.sessionFailover.nameService}`);
        availableSessions.push(sessionList.sessionFailover)
    }

    // if (availableSessions.length === 0 && !sessionList.sessionFailover.nameService) {
    //     await appendToLog(`HẾT SESSION`, process.env.LOGS_SERVER_SEXY)
    //     await sendTelegramMessage(process.env.TOKEN_BOT, process.env.ID_TELEGRAM_RECIPIENT, "HẾT SESSION")
    //     return
    // }

    while (availableSessions.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableSessions.length);
        const selectedSession = availableSessions[randomIndex];
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S2] using session ${selectedSession.nameService} => ${selectedSession.sessionId?.slice(0, 12)}...`)
        const data = await requestData(selectedSession.sessionId);
        if (!Array.isArray(data.tableItems) || data.tableItems.length === 0) {
            console.warn(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S3] invalid hall session — no tableItems`, {
                keys: data && typeof data === 'object' ? Object.keys(data) : [],
                sessionName: selectedSession.nameService,
                sessionId: selectedSession.sessionId?.slice(0, 8),
            });
            for (const key of sessionKeys) {
                if (sessionList.session[key].sessionId === selectedSession.sessionId) {
                    sessionList.session[key] = {
                        ...sessionList.session[key],
                        nameService: undefined,
                        sessionId: undefined,
                        stampTime: -1,
                    };
                }
            }
            return
        }
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S3] received tableItems=${data.tableItems.length} from ${selectedSession.nameService}`)
        const dataTableList = filterData(data.tableItems)
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S4] filterData => ${dataTableList.length} tables`)

        await initDatabase(dataTableList)
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S5] initDatabase done`)

        await checkAndUpdateDatabase(dataTableList)
        console.log(`${getCurrentTime().timeFormatted} [CRAWL][STEP_S6] checkAndUpdateDatabase done — data saved to DB`)

        // bắn dữ liệu
        // io.emit('test_data', {
        //     data: JSON.stringify(dataTableList),
        //     stampTime: getCurrentTime().timeUnix,
        // });
        // console.log('Bắn dữ liệu socket')
        // const byteSize = Buffer.byteLength(JSON.stringify(dataTableList), 'utf8');
        // console.log(`Dung lượng JSON: ${byteSize} bytes ~ ${(byteSize / 1024).toFixed(2)} KB`);
        return
    }
}, 1500);

server.listen(PORT, async () => {
    await appendToLog(`Running server http://localhost:${PORT}`, process.env.LOGS_SERVER_SEXY)
})