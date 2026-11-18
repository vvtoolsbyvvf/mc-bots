const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const cors = require('cors');

const app = express();
app.use(cors());

// Endpoint healthcheck dla Railway
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

const bots = new Map();

// GLOBALNA KOLEJKA – chroni przed spamem z frontendu vvTools i banem IP na Aternosie
let globalQueue = [];
let isProcessingQueue = false;

function processGlobalQueue(socket) {
    if (isProcessingQueue || globalQueue.length === 0) return;

    isProcessingQueue = true;
    const task = globalQueue.shift();

    console.log(`[Queue] Odpalam bota z kolejki: ${task.username} (pozostało w kolejce: ${globalQueue.length})`);
    socket.emit('log', `[System] Start bota ${task.username} (w kolejce: ${globalQueue.length})...`);

    createBot(socket, task, () => {
        // Czekamy sztywne 15 sekund przed wyciągnięciem kolejnego bota z kolejki (Aternos anti-throttle)
        setTimeout(() => {
            isProcessingQueue = false;
            processGlobalQueue(socket);
        }, 15000);
    });
}

io.on('connection', (socket) => {
    console.log(`[Backend] Nowy klient polaczony z panelem vvTools: ${socket.id}`);

    socket.on('start-bots', (data) => {
        const { host, port, count, prefix, version } = data;
        const targetPort = parseInt(port) || 25565;
        const botCount = parseInt(count) || 1;
        const botPrefix = prefix || 'Bot_';

        console.log(`[BotManager] Otrzymano zlecenie na ${botCount} botów dla ${host}:${targetPort}`);
        socket.emit('log', `[System] Dodaję ${botCount} botów do globalnej kolejki...`);

        // Dodajemy zadania do globalnej tablicy
        for (let i = 0; i < botCount; i++) {
            const username = `${botPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
            globalQueue.push({
                host: host.trim(),
                port: targetPort,
                username,
                version: version && version !== 'auto' ? version : false
            });
        }

        // Uruchamiamy przetwarzanie kolejki, jeśli stoi
        processGlobalQueue(socket);
    });

    socket.on('stop-bots', () => {
        console.log(`[BotManager] Zatrzymywanie wszystkich botow (${bots.size}) oraz czyszczenie kolejki`);
        globalQueue = []; // Czyścimy kolejkę
        isProcessingQueue = false;
        
        bots.forEach((bot, name) => {
            try {
                bot.quit();
            } catch (e) {}
            bots.delete(name);
        });
        socket.emit('log', `[System] Zatrzymano boty i wyczyszczono kolejkę.`);
        socket.emit('bot-count', 0);
    });

    socket.on('send-chat', (message) => {
        bots.forEach((bot) => {
            if (bot && bot.player) {
                bot.chat(message);
            }
        });
        socket.emit('log', `[Czat] Wysłano: ${message}`);
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient rozlaczony: ${socket.id}`);
    });
});

function createBot(socket, options, onFinished) {
    socket.emit('log', `[${options.username}] Łączenie z ${options.host}:${options.port}...`);
    console.log(`[Bot] Tworzenie instancji ${options.username} -> ${options.host}:${options.port}`);

    let bot;
    let finishedCalled = false;

    function finish() {
        if (!finishedCalled) {
            finishedCalled = true;
            if (onFinished) onFinished();
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
            checkTimeoutInterval: 30000
        });
    } catch (err) {
        console.error(`[Bot Error Init] ${options.username}:`, err.message);
        socket.emit('log', `[${options.username}] Błąd inicjalizacji: ${err.message}`);
        finish();
        return;
    }

    bots.set(options.username, bot);

    // Awaryjny timeout: zwalnia kolejkę po 15 sekundach w razie zwisu
    const safetyTimer = setTimeout(() => {
        socket.emit('log', `[${options.username}] ⚠️ Timeout połączenia. Zwalniam kolejkę.`);
        try { bot.quit(); } catch(e) {}
        bots.delete(options.username);
        socket.emit('bot-count', bots.size);
        finish();
    }, 15000);

    bot.once('spawn', () => {
        clearTimeout(safetyTimer);
        console.log(`[Bot] ${options.username} wszedl na serwer!`);
        socket.emit('log', `[${options.username}] ✅ Połączono i zespawnowano na serwerze!`);
        socket.emit('bot-count', bots.size);
        finish();
    });

    bot.on('login', () => {
        socket.emit('log', `[${options.username}] Zalogowano do protokołu TCP, czekam na spawn...`);
    });

    bot.on('messagestr', (message) => {
        if (message.trim().length > 0) {
            socket.emit('log', `[Serwer -> ${options.username}] ${message}`);
        }
    });

    bot.on('kicked', (reason) => {
        clearTimeout(safetyTimer);
        let parsedReason = reason;
        try {
            const obj = JSON.parse(reason);
            parsedReason = obj.text || JSON.stringify(obj);
        } catch (e) {}
        
        console.log(`[Bot Kicked] ${options.username}: ${parsedReason}`);
        socket.emit('log', `[${options.username}] ❌ Wyrzucony przez serwer: ${parsedReason}`);
        bots.delete(options.username);
        socket.emit('bot-count', bots.size);
        finish();
    });

    bot.on('error', (err) => {
        clearTimeout(safetyTimer);
        console.error(`[Bot Error] ${options.username}:`, err.message);
        socket.emit('log', `[${options.username}] ⚠️ Błąd połączenia: ${err.message}`);
        bots.delete(options.username);
        socket.emit('bot-count', bots.size);
        finish();
    });

    bot.on('end', (reason) => {
        clearTimeout(safetyTimer);
        console.log(`[Bot End] ${options.username}: ${reason}`);
        socket.emit('log', `[${options.username}] Rozłączono (${reason || 'koniec sesji'}).`);
        bots.delete(options.username);
        socket.emit('bot-count', bots.size);
        finish();
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Serwer ruszyl na porcie ${PORT}`);
});
