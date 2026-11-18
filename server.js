const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const cors = require('cors');

// Bezwzględna ochrona przed jakimkolwiek crashem procesu
process.on('uncaughtException', (err) => {
    console.error('[CRASH GUARD] Ignorowany błąd krytyczny:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[CRASH GUARD] Ignorowane odrzucenie:', reason);
});

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('BotManager Ultra Stable Online');
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

function processQueue(socket) {
    if (isSpawning || botQueue.length === 0) return;

    isSpawning = true;
    const botData = botQueue.shift();

    try {
        socket.emit('log', `[System] Wypuszczam bota: ${botData.username} (w kolejce: ${botQueue.length})`);
    } catch(e) {}

    createSafeBot(socket, botData, () => {
        setTimeout(() => {
            isSpawning = false;
            processQueue(socket);
        }, 15000); // 15 sekund przerwy
    });
}

io.on('connection', (socket) => {
    console.log(`[Backend] Klient połączony: ${socket.id}`);

    socket.on('start-bots', (data) => {
        try {
            const rawHost = data.host || data.address || data.ip;
            const targetPort = parseInt(data.port) || 11670;
            const botCount = parseInt(data.count) || 1;
            const botPrefix = data.prefix || 'Bot_';
            
            // Pobieramy wersję z panelu lub domyślnie dajemy false (auto-detekcja) żeby Mineflayer sam dopasował protokół
            const clientVersion = data.version && data.version !== 'auto' ? data.version : false;

            if (!rawHost) {
                socket.emit('log', `[System] ❌ Błąd: Brak adresu serwera!`);
                return;
            }

            const cleanHost = String(rawHost).trim();
            socket.emit('log', `[System] Zlecenie: ${botCount} botów -> ${cleanHost}:${targetPort}`);

            botQueue = [];
            for (let i = 0; i < botCount; i++) {
                const username = `${botPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
                botQueue.push({
                    host: cleanHost,
                    port: targetPort,
                    username,
                    version: clientVersion
                });
            }

            if (!isSpawning) {
                processQueue(socket);
            }
        } catch (err) {
            console.error('[Start Error]', err.message);
            socket.emit('log', `[System] Błąd startu: ${err.message}`);
        }
    });

    socket.on('stop-bots', () => {
        botQueue = [];
        isSpawning = false;
        activeBots.forEach((bot) => {
            try { bot.quit(); } catch (e) {}
        });
        activeBots.clear();
        try {
            socket.emit('log', `[System] Zatrzymano wszystkie boty.`);
            socket.emit('bot-count', 0);
        } catch(e) {}
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient rozłączony: ${socket.id}`);
    });
});

function createSafeBot(socket, options, onDone) {
    let bot;
    let finished = false;

    function finishTask() {
        if (!finished) {
            finished = true;
            if (onDone) onDone();
        }
    }

    try {
        socket.emit('log', `[${options.username}] Tworzenie instancji...`);
        
        bot = mineflayer.createBot({
            host: options.host,
            port: options.port,
            username: options.username,
            version: options.version, // Jeśli wywoła błąd wersji, zostanie przechwycony
            auth: 'offline',
            hideErrors: true,
            checkTimeoutInterval: 30000
        });
    } catch (err) {
        socket.emit('log', `[${options.username}] Błąd init: ${err.message}`);
        finishTask();
        return;
    }

    activeBots.set(options.username, bot);

    const safetyTimer = setTimeout(() => {
        socket.emit('log', `[${options.username}] ⚠️ Timeout połączenia.`);
        try { bot.quit(); } catch(e) {}
        activeBots.delete(options.username);
        try { socket.emit('bot-count', activeBots.size); } catch(e) {}
        finishTask();
    }, 20000);

    bot.once('spawn', () => {
        clearTimeout(safetyTimer);
        try {
            socket.emit('log', `[${options.username}] ✅ Bot wbił na serwer!`);
            socket.emit('bot-count', activeBots.size);
        } catch(e) {}
        setTimeout(finishTask, 2000);
    });

    bot.on('kicked', (reason) => {
        clearTimeout(safetyTimer);
        let parsed = reason;
        try {
            const obj = JSON.parse(reason);
            parsed = obj.text || JSON.stringify(obj);
        } catch (e) {}

        try {
            socket.emit('log', `[${options.username}] ❌ Wyrzucony: ${parsed}`);
            socket.emit('bot-count', activeBots.size);
        } catch(e) {}
        activeBots.delete(options.username);
        finishTask();
    });

    bot.on('error', (err) => {
        clearTimeout(safetyTimer);
        try {
            socket.emit('log', `[${options.username}] ⚠️ Błąd bota: ${err.message}`);
            socket.emit('bot-count', activeBots.size);
        } catch(e) {}
        activeBots.delete(options.username);
        finishTask();
    });

    bot.on('end', () => {
        clearTimeout(safetyTimer);
        activeBots.delete(options.username);
        try { socket.emit('bot-count', activeBots.size); } catch(e) {}
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Serwer ruszył na porcie ${PORT}`);
});
