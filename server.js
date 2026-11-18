const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const cors = require('cors');

// Zabezpieczenie przed crashem całego procesu Node.js na Railway
process.on('uncaughtException', (err) => {
    console.error('[CRASH GUARD]', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[CRASH GUARD PROMISE]', reason);
});

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('BotManager Final Stable Backend Online');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const activeBots = new Map();
let botQueue = [];
let isSpawning = false;

// Bezpieczna globalna kolejka z przerwą antyspamową dla Aternosa
function processQueue(socket) {
    if (isSpawning || botQueue.length === 0) return;

    isSpawning = true;
    const botData = botQueue.shift();

    socket.emit('log', `[System] Wypuszczam bota: ${botData.username} (w kolejce: ${botQueue.length})`);

    createSafeBot(socket, botData, () => {
        // 18 sekund przerwy między botami, żeby Aternos nie zablokował IP
        setTimeout(() => {
            isSpawning = false;
            processQueue(socket);
        }, 18000);
    });
}

io.on('connection', (socket) => {
    console.log(`[Backend] Klient połączony z vvTools: ${socket.id}`);

    socket.on('start-bots', (data) => {
        try {
            const rawHost = data.host || data.address || data.ip;
            const targetPort = parseInt(data.port) || 11670;
            const botCount = parseInt(data.count) || 1;
            const botPrefix = data.prefix || 'Bot_';
            
            // SZTYWNIE WYMUSZONA WERSJA DLA ATERNOSA 1.21.11
            const version = '1.21.11';

            if (!rawHost) {
                socket.emit('log', `[System] ❌ Błąd: Brak adresu serwera!`);
                return;
            }

            const cleanHost = String(rawHost).trim();
            socket.emit('log', `[System] Zlecenie: ${botCount} botów -> ${cleanHost}:${targetPort} (Wersja: ${version})`);

            botQueue = [];
            for (let i = 0; i < botCount; i++) {
                const username = `${botPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
                botQueue.push({
                    host: cleanHost,
                    port: targetPort,
                    username,
                    version
                });
            }

            if (!isSpawning) {
                processQueue(socket);
            }
        } catch (err) {
            console.error('[Start Error]', err.message);
            socket.emit('log', `[System] Błąd krytyczny startu: ${err.message}`);
        }
    });

    socket.on('stop-bots', () => {
        botQueue = [];
        isSpawning = false;
        activeBots.forEach((bot) => {
            try { bot.quit(); } catch (e) {}
        });
        activeBots.clear();
        socket.emit('log', `[System] Zatrzymano wszystkie boty i wyczyszczono kolejkę.`);
        socket.emit('bot-count', 0);
    });

    socket.on('send-chat', (message) => {
        activeBots.forEach((bot) => {
            if (bot && bot.player) bot.chat(message);
        });
        socket.emit('log', `[Czat] Wysłano: ${message}`);
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient rozłączony: ${socket.id}`);
    });
});

function createSafeBot(socket, options, onDone) {
    socket.emit('log', `[${options.username}] Łączenie z ${options.host}:${options.port} (${options.version})...`);
    
    let bot;
    let finished = false;

    function finishTask() {
        if (!finished) {
            finished = true;
            if (onDone) onDone();
        }
    }

    try {
        bot = mineflayer.createBot({
            host: options.host,
            port: options.port,
            username: options.username,
            version: options.version,
            auth: 'offline',
            hideErrors: false,
            checkTimeoutInterval: 45000
        });
    } catch (err) {
        socket.emit('log', `[${options.username}] Błąd inicjalizacji: ${err.message}`);
        finishTask();
        return;
    }

    activeBots.set(options.username, bot);

    const connectionTimeout = setTimeout(() => {
        socket.emit('log', `[${options.username}] ⚠️ Timeout połączenia. Zwalniam kolejkę.`);
        try { bot.quit(); } catch(e) {}
        activeBots.delete(options.username);
        socket.emit('bot-count', activeBots.size);
        finishTask();
    }, 20000);

    bot.once('spawn', () => {
        clearTimeout(connectionTimeout);
        socket.emit('log', `[${options.username}] ✅ Zespawnowany na serwerze!`);
        socket.emit('bot-count', activeBots.size);
        setTimeout(finishTask, 2000);
    });

    bot.on('kicked', (reason) => {
        clearTimeout(connectionTimeout);
        let parsedReason = reason;
        try {
            const obj = JSON.parse(reason);
            parsedReason = obj.text || JSON.stringify(obj);
        } catch (e) {}

        socket.emit('log', `[${options.username}] ❌ Wyrzucony: ${parsedReason}`);
        activeBots.delete(options.username);
        socket.emit('bot-count', activeBots.size);
        finishTask();
    });

    bot.on('error', (err) => {
        clearTimeout(connectionTimeout);
        socket.emit('log', `[${options.username}] ⚠️ Błąd sieciowy: ${err.message}`);
        activeBots.delete(options.username);
        socket.emit('bot-count', activeBots.size);
        finishTask();
    });

    bot.on('end', () => {
        clearTimeout(connectionTimeout);
        activeBots.delete(options.username);
        socket.emit('bot-count', activeBots.size);
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Serwer ruszył na porcie ${PORT}`);
});
