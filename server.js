const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('BotManager Backend Online');
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
let queueTimer = null;
let isSpawning = false;

// Pancerna funkcja przetwarzająca kolejkę po jednym bocie
function processQueue(socket) {
    if (isSpawning || botQueue.length === 0) return;

    isSpawning = true;
    const botData = botQueue.shift();

    console.log(`[Queue] Pobieram z kolejki. Zostało do wpuszczenia: ${botQueue.length}`);
    socket.emit('log', `[System] Wypuszczam bota: ${botData.username} (w kolejce: ${botQueue.length})`);

    createSafeBot(socket, botData, () => {
        // Czekamy sztywne 18 sekund ZANIM zwolnimy blokadę dla kolejnego bota
        setTimeout(() => {
            isSpawning = false;
            processQueue(socket);
        }, 18000); // 18 sekund bufora dla Aternosa
    });
}

io.on('connection', (socket) => {
    console.log(`[Backend] Nowy klient z panela vvTools: ${socket.id}`);

    socket.on('start-bots', (data) => {
        const { host, port, count, prefix, version } = data;
        const targetPort = parseInt(port) || 25565;
        const botCount = parseInt(count) || 1;
        const botPrefix = prefix || 'Bot_';

        console.log(`[BotManager] Zlecenie na ${botCount} botów -> ${host}:${targetPort}`);
        socket.emit('log', `[System] Przyjęto zlecenie na ${botCount} botów. Dodaję do bezpiecznej kolejki...`);

        // Czyszczymy starą kolejkę przed nowym zleceniem
        botQueue = [];

        for (let i = 0; i < botCount; i++) {
            const username = `${botPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
            botQueue.push({
                host: host.trim(),
                port: targetPort,
                username,
                version: version && version !== 'auto' ? version : false
            });
        }

        // Startujemy procesor kolejki, jeśli nie działa
        if (!isSpawning) {
            processQueue(socket);
        }
    });

    socket.on('stop-bots', () => {
        console.log(`[BotManager] Awaryjne zatrzymywanie wszystkich botów.`);
        botQueue = [];
        isSpawning = false;

        activeBots.forEach((bot, name) => {
            try { bot.quit(); } catch (e) {}
            activeBots.delete(name);
        });

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
    socket.emit('log', `[${options.username}] Łączenie z TCP ${options.host}:${options.port}...`);
    
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
        socket.emit('log', `[${options.username}] Błąd krytyczny init: ${err.message}`);
        finishTask();
        return;
    }

    activeBots.set(options.username, bot);

    // Zabezpieczenie czasowe: jeśli bot nie wejdzie w 15 sekund, zwalniamy kolejkę, żeby nie zablokować innych
    const connectionTimeout = setTimeout(() => {
        socket.emit('log', `[${options.username}] ⚠️ Timeout TCP/Spawn. Zwalniam kolejkę dla kolejnego bota.`);
        try { bot.quit(); } catch(e) {}
        activeBots.delete(options.username);
        socket.emit('bot-count', activeBots.size);
        finishTask();
    }, 15000);

    bot.once('spawn', () => {
        clearTimeout(connectionTimeout);
        socket.emit('log', `[${options.username}] ✅ Sukces! Zespawnowany na serwerie.`);
        socket.emit('bot-count', activeBots.size);
        // Ważne: dajemy chwilę stabilizacji i zwalniamy kolejkę
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

    bot.on('end', (reason) => {
        clearTimeout(connectionTimeout);
        activeBots.delete(options.username);
        socket.emit('bot-count', activeBots.size);
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Serwer ruszyl na porcie ${PORT}`);
});
