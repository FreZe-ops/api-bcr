const isEqual = require('lodash.isequal');
require('dotenv').config();

const { predictResultSchema } = require('../config/schema/index.schema')
const {
    getCurrentTime,
    sortByStampTimeDesc,
    calculateGroupThreeSeries,
    calculateWinningPercentage,
    getRandomInRange,
    getRandomPercentages,
    checkWhoWinRound,
    currentGameStatus,
    appendToLog,
} = require('./helper');

function filterData(data = []) {
    return data.map(item => {
        // const bigRoads = [...(item?.roadInfo?.bigRoads ?? [])].sort((a, b) => b.stampTime - a.stampTime);
        const bigRoads = [...(item?.roadInfo?.bigRoads ?? [])]
            .sort((a, b) => b.stampTime - a.stampTime)
            .map((item, index, array) => ({
                ...item,
                id: array.length - index
            }));
        let currentGame = currentGameStatus(item)

        return {
            tableInfo: {
                stampTime: item.tableInfo.stampTime,
                tableID: item.tableInfo.tableID,
                tableName: item.tableInfo.tableName,
                maintenance: item.tableInfo.maintenance,
                dealerImage: item.tableInfo.dealerImage
                    ? `https://vcnh2k.gklam.com/images/player/dealers/png/${item.tableInfo.dealerImage}`
                    : null,
                // newGame: item.tableInfo.newGame,
            },
            dealerEvent: {
                eventType: item.dealerEvent.eventType,
                gameRound: item.dealerEvent.gameRound,
                iTime: item.dealerEvent.iTime,
                roundStartTime: item.dealerEvent.roundStartTime,
                shuffle: item.dealerEvent.shuffle,
                statusGame: currentGame.status,
                // countDownFormat: currentGame.countDownFormat,
                // countDownUnix: currentGame.countDownUnix,
            },
            roadInfo: {
                repaintTime: item.roadInfo.repaintTime,
                winCounts: item.roadInfo.winCounts,
                prevGoodRoadJson: item.roadInfo.prevGoodRoadJson,
                currGoodRoadJson: item.roadInfo.currGoodRoadJson,
                bigRoads
            }
        };
    });
}

// init table
async function initDatabase(dataTableList) {
    try {
        let dataTableList_DB = []
        for (let i = 0; i < dataTableList.length; i++) {
            let tableDB = await predictResultSchema.findOne({ tableName: dataTableList[i].tableInfo.tableName })

            if (!tableDB) {
                tableDB = await initTableNew(dataTableList[i])
                dataTableList_DB.push(tableDB)
            }
        }

        return dataTableList_DB
    } catch (err) {
        await appendToLog(`Lỗi khi xử lý table : ${err}`, process.env.LOGS_SERVER_SEXY)
        return []
    }
}

async function initTableNew(table) {
    try {
        let totalRound = [];

        if (table.roadInfo.bigRoads.length > 0) {
            const sorted = [...table.roadInfo.bigRoads].sort(
                (a, b) => Number(b.stampTime) - Number(a.stampTime)
            );

            const total = sorted.length;

            totalRound = sorted.map((item, index) => ({
                ...item,
                win: true,
                roadFormat: checkWhoWinRound(item.road),
                roadRandom: checkWhoWinRound(item.road),
                id: total - index
            }));
        }
        let tableDB = new predictResultSchema({
            tableName: table.tableInfo.tableName,
            tableID: table.tableInfo.tableID,
            maintenance: table.tableInfo.maintenance,
            dealerImage: table.tableInfo.dealerImage,
            // eventType: table.dealerEvent.eventType,
            // gameRound: table.dealerEvent.gameRound,
            iTime: table.dealerEvent.iTime,
            roundStartTime: table.dealerEvent.roundStartTime,
            shuffle: table.dealerEvent.shuffle,
            statusGame: table.dealerEvent.statusGame,
            // countDownUnix: table.dealerEvent.counatDownUnix,
            percentCurrent: {
                Player: null,
                Tier: null,
                Banker: null,
                Round: null,
                Forecast: null,
            },
            totalRound
        })
        await appendToLog(`Đã thêm table ${table.tableInfo.tableName} vào CSDL`, process.env.LOGS_SERVER_SEXY)
        await tableDB.save();
        return tableDB;
    } catch (error) {
        await appendToLog(`Error init new table ${error}`, process.env.LOGS_SERVER_SEXY)
    }
}

async function removeObsoleteRounds(tableName, bigRoads, totalRoundDB) {
    const newStampSet = new Set(bigRoads.map(r => Number(r.stampTime)));

    const roundsToDelete = totalRoundDB.filter(
        r => !newStampSet.has(Number(r.stampTime))
    );

    if (roundsToDelete.length === 0) return;

    const stampTimesToDelete = roundsToDelete.map(r => r.stampTime);

    await predictResultSchema.updateOne(
        { tableName },
        { $pull: { totalRound: { stampTime: { $in: stampTimesToDelete } } } }
    );

    await appendToLog(`❌ Đã xoá ${roundsToDelete.length} round cũ khỏi ${tableName}`, process.env.LOGS_SERVER_SEXY)
}

async function syncNewRounds(tableName, bigRoads, dbTable) {
    let totalRoundDB = sortByStampTimeDesc(dbTable.totalRound);
    const existingStamps = new Set(totalRoundDB.map(r => Number(r.stampTime)));

    const newRoundsRaw = bigRoads.filter(r => !existingStamps.has(Number(r.stampTime)));
    if (newRoundsRaw.length === 0) return;

    // Tìm ID lớn nhất hiện có trong DB (nếu không có thì bắt đầu từ 0)
    const maxId = totalRoundDB.reduce((max, r) => Math.max(max, Number(r.id || 0)), 0);
    // Sắp xếp các round mới theo stampTime giảm dần (trong trường hợp server delay sẽ nạp nhiều trường vào db)
    const sortedRounds = [...newRoundsRaw].sort((a, b) => Number(b.stampTime) - Number(a.stampTime));

    // gán id tiếp nối từ maxId + 1 trở đi
    const newRounds = sortedRounds.map((r, index) => ({
        stampTime: r.stampTime,
        showX: r.showX,
        showY: r.showY,
        count: r.count,
        road: r.road,
        win: true,
        roadFormat: checkWhoWinRound(r.road),
        roadRandom: dbTable.percentCurrent.Round || null,
        id: maxId + (index + 1)
    }));

    totalRoundDB.unshift(newRounds)
    const randomRound = getRandomPercentages()
    const calculate = calculateWinningPercentage(totalRoundDB)

    let percent = {
        ...randomRound,
        Forecast: calculate,
    }

    console.log(percent)
    await predictResultSchema.updateOne(
        { tableName },
        {
            $set: {
                percentCurrent: percent
            },
            $push: {
                totalRound: { $each: newRounds }
            }
        }
    );
// if(tableName == 'C15') console.log(`\n\n===================> ${sortedRounds[0].road} - ${tableName} `)
    
    await appendToLog(`✅ Đã thêm ${newRounds.length} round mới vào ${tableName}, bắt đầu từ id = ${maxId + 1}`, process.env.LOGS_SERVER_SEXY)
}

// luôn cập nhật trạng thái bàn với nếu có thay đôi
async function updateStatusTable(dbTable, table) {
    try {
        let statusTableNew = {
            maintenance: table.tableInfo.maintenance,
            roundStartTime: table.dealerEvent.roundStartTime,
            shuffle: table.dealerEvent.shuffle,
            statusGame: currentGameStatus(table).status,
        }
        let _dbTable = {
            maintenance: dbTable.maintenance,
            roundStartTime: dbTable.roundStartTime,
            shuffle: dbTable.shuffle,
            statusGame: dbTable.statusGame,
        }
        if (isEqual(statusTableNew, _dbTable)) return;

        await predictResultSchema.updateOne(
            { tableName: dbTable.tableName },
            { $set: statusTableNew }
        );

    } catch (err) {
        await appendToLog(`Lỗi khi cập nhật trạng thái table: ${dbTable.tableName}`, process.env.LOGS_SERVER_SEXY);
    }
}

async function checkAndUpdateDatabase(dataTableList) {
    try {
        const formattedList = dataTableList.map(item => ({
            tableName: item.tableInfo.tableName,
            table: item,
            bigRoads: item.roadInfo?.bigRoads ?? []
        }));

        const dbTables = await predictResultSchema.find().select('tableName totalRound percentCurrent -_id');
        for (const { tableName, bigRoads, table } of formattedList) {
            const dbTable = dbTables.find(item => item.tableName === tableName);

            if (!dbTable) {
                await appendToLog(`❗ Không tìm thấy tableName ${tableName} trong DB`, process.env.LOGS_SERVER_SEXY)
                continue;
            }

            await updateStatusTable(dbTable, table)
            await syncNewRounds(tableName, bigRoads, dbTable);
            await removeObsoleteRounds(tableName, bigRoads, dbTable.totalRound);
        }
    } catch (err) {
        await appendToLog(`Lỗi khi đồng bộ DB checkAndUpdateDatabase ${err} trong DB`, process.env.LOGS_SERVER_SEXY)
    }
}

module.exports = {
    filterData,
    initDatabase,
    checkAndUpdateDatabase,
};
