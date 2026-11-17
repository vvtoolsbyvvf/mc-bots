const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const dns = require('dns');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let activeBots = [];

io.on('connection', (socket) => {
    console.log(`[Backend] Nowy klient polaczony z panelem: ${socket.id}`);

    socket.emit('bot-log', { text: '[System] Polaczono z backendem w chmurze.', type: 'success' });
    updateClients(io);

    socket.on('start-bots', (data) => {
        const { ip, count, names, antiAfk } = data;
        if (!ip) return;

        // Automatyczne dopasowanie hosta i portu (np. z Aternosa typu adrs:port)
        let host = ip.trim();
        let serverPort = 25565;

        if (host.includes(':')) {
            const parts = host.split(':');
            host = parts[0];
            serverPort = parseInt(parts[1], 10) || 25565;
        }

        console.log(`[BotManager] Uruchamianie ${count} botow dla ${host}:${serverPort} (Klient: ${socket.id})`);
        io.emit('bot-log', { text: `[System] Próba spawnu ${count} botow na ${host}:${serverPort}...`, type: 'info' });

        const RANDOM_PREFIXES = ['Kacper', 'Bartek', 'Stasiek', 'Mat', 'Pro', 'Xx', 'Super', 'Hyper', 'Shadow', 'Craft', 'Builder'];
        
        for (let i = 0; i < count; i++) {
            let botName = names && names[i] ? names[i] : `${RANDOM_PREFIXES[Math.floor(Math.random() * RANDOM_PREFIXES.length)]}${Math.floor(Math.random() * 900) + 100}`;
            
            if (activeBots.some(b => b.name === botName)) {
                botName = `${botName}_${i}`;
            }

            try {
                const bot = mineflayer.createBot({
                    host: host,
                    port: serverPort,
                    username: botName,
                    version: false
                });

                const botData = {
                    name: botName,
                    status: 'Laczenie...',
                    instance: bot,
                    antiAfkInterval: null,
                    ownerSocket: socket.id
                };

                activeBots.push(botData);
                updateClients(io);

                bot.on('spawn', () => {
                    botData.status = 'W grze';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Dolaczyl do serwera!`, type: 'success' });

                    if (antiAfk) {
                        botData.antiAfkInterval = setInterval(() => {
                            try {
                                bot.setControlState('jump', true);
                                setTimeout(() => bot.setControlState('jump', false), 400);
                            } catch (e) {}
                        }, 35000);
                    }
                });

                bot.on('chat', (username, message) => {
                    if (username === botName) return;
                    io.emit('bot-log', { text: `<${username}> ${message}`, type: 'chat' });
                });

                bot.on('kicked', (reason) => {
                    botData.status = 'Wyrzucony';
                    updateClients(io);
                    let cleanReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
                    io.emit('bot-log', { text: `[${botName}] Wyrzucony z serwera! Powod: ${cleanReason}`, type: 'error' });
                });

                bot.on('error', (err) => {
                    botData.status = 'Blad';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Blad mineflayer: ${err.message}`, type: 'error' });
                });

                bot.on('end', (reason) => {
                    if (botData.antiAfkInterval) clearInterval(botData.antiAfkInterval);
                    botData.status = 'Rozlaczony';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Rozlaczony. Powod: ${reason}`, type: 'error' });
                });

            } catch (err) {
                io.emit('bot-log', { text: `[System] Blad tworzenia bota ${botName}: ${err.message}`, type: 'error' });
            }
        }
    });

    socket.on('console-command', (data) => {
        const { message } = data;
        if (!message) return;

        io.emit('bot-log', { text: `[Konsola] Wysylam: ${message}`, type: 'chat' });

        activeBots.forEach(b => {
            if (b.instance && b.status === 'W grze') {
                b.instance.chat(message);
            }
        });
    });

    socket.on('stop-bots', () => {
        stopAllBots();
        io.emit('bot-log', { text: '[System] Zatrzymano wszystkie boty.', type: 'error' });
        updateClients(io);
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient rozlaczony: ${socket.id}`);
    });
});

function stopAllBots() {
    activeBots.forEach(b => {
        if (b.antiAfkInterval) clearInterval(b.antiAfkInterval);
        try { b.instance.quit(); } catch (e) {}
    });
    activeBots = [];
}

function updateClients(ioInstance) {
    const simplifiedBots = activeBots.map(b => ({
        name: b.name,
        status: b.status,
        owner: b.ownerSocket
    }));
    ioInstance.emit('bots-update', { bots: simplifiedBots });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`[Backend] Serwer ruszył na porcie ${PORT}`);
});
