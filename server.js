const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const dns = require('dns');

process.on('uncaughtException', (err) => {
    console.error('Wychwycono krytyczny błąd procesów:', err);
});

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
        const { ip, count, names, antiAfk, version } = data;
        if (!ip) return;

        let cleanInput = ip.trim();
        let targetHost = cleanInput;
        let targetPort = 25565;

        if (cleanInput.includes(':')) {
            const parts = cleanInput.split(':');
            targetHost = parts[0];
            targetPort = parseInt(parts[1], 10) || 25565;
            spawnBotsBatch(targetHost, targetPort, count, names, antiAfk, version, socket, io);
        } else {
            io.emit('bot-log', { text: `[System] Pobieranie danych DNS dla ${targetHost}...`, type: 'info' });
            
            dns.resolveSrv(`_minecraft._tcp.${targetHost}`, (err, addresses) => {
                if (!err && addresses && addresses.length > 0) {
                    targetHost = addresses[0].name;
                    targetPort = addresses[0].port;
                    io.emit('bot-log', { text: `[System] Wykryto port Aternosa: ${targetHost}:${targetPort}`, type: 'success' });
                    spawnBotsBatch(targetHost, targetPort, count, names, antiAfk, version, socket, io);
                } else {
                    io.emit('bot-log', { text: `[System] Brak rekordu SRV, próbuję połączyć się bezpośrednio z ${targetHost}:25565`, type: 'info' });
                    spawnBotsBatch(targetHost, 25565, count, names, antiAfk, version, socket, io);
                }
            });
        }
    });

    socket.on('bot-command', (data) => {
        const { botName, message } = data;
        if (!botName || !message) return;

        const targetBot = activeBots.find(b => b.name === botName);
        if (targetBot && targetBot.instance && targetBot.status === 'W grze') {
            targetBot.instance.chat(message);
        }
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

function spawnBotsBatch(host, port, count, names, antiAfk, version, socket, io) {
    const maxBots = Math.min(parseInt(count, 10) || 1, 100);
    console.log(`[BotManager] Kolejkowanie ${maxBots} botow dla ${host}:${port} (Wersja: ${version})`);
    io.emit('bot-log', { text: `[System] Start kolejki ${maxBots} botów (Wersja: ${version})...`, type: 'info' });

    const RANDOM_PREFIXES = ['Kacper', 'Bartek', 'Stasiek', 'Mat', 'Pro', 'Xx', 'Super', 'Hyper', 'Shadow', 'Craft', 'Builder'];

    for (let i = 0; i < maxBots; i++) {
        setTimeout(() => {
            if (socket.disconnected && activeBots.length === 0) return;

            let botName = names && names[i] ? names[i] : `${RANDOM_PREFIXES[Math.floor(Math.random() * RANDOM_PREFIXES.length)]}${Math.floor(Math.random() * 900) + 100}`;
            
            if (activeBots.some(b => b.name === botName)) {
                botName = `${botName}_${i}`;
            }

            try {
                // Jawna wersja pomija zablokowany przez Aternos ping na Renderze
                const bot = mineflayer.createBot({
                    host: host,
                    port: port,
                    username: botName,
                    version: version || '1.20.4', 
                    skipValidation: true,
                    checkTimeoutInterval: 60000
                });

                const botData = {
                    name: botName,
                    status: 'Łączenie...',
                    instance: bot,
                    antiAfkInterval: null,
                    ownerSocket: socket.id
                };

                activeBots.push(botData);
                updateClients(io);

                if (bot._client) {
                    bot._client.on('resource_pack_send', (packet) => {
                        try {
                            bot._client.write('resource_pack_receive', {
                                uuid: packet.uuid,
                                result: 3
                            });
                        } catch (e) {}
                    });

                    bot._client.on('connect', () => {
                        try { bot._client.socket.setKeepAlive(true, 0); } catch (e) {}
                    });
                }

                bot.on('spawn', () => {
                    setTimeout(() => {
                        if (botData.status === 'Łączenie...') {
                            botData.status = 'W grze';
                            updateClients(io);
                            io.emit('bot-log', { text: `[${botName}] Dołączył pomyślnie do serwera!`, type: 'success' });

                            if (antiAfk) {
                                botData.antiAfkInterval = setInterval(() => {
                                    try {
                                        bot.setControlState('jump', true);
                                        setTimeout(() => bot.setControlState('jump', false), 400);
                                    } catch (e) {}
                                }, 30000);
                            }
                        }
                    }, 2000);
                });

                bot.on('chat', (username, message) => {
                    if (username === botName) return;
                    io.emit('bot-chat-message', {
                        botName: botName,
                        message: `<${username}> ${message}`
                    });
                });

                bot.on('kicked', (reason) => {
                    botData.status = 'Wyrzucony';
                    updateClients(io);
                    let cleanReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
                    io.emit('bot-log', { text: `[${botName}] Wyrzucony: ${cleanReason}`, type: 'error' });
                });

                bot.on('error', (err) => {
                    botData.status = 'Błąd';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Błąd sieciowy: ${err.message}`, type: 'error' });
                });

                bot.on('end', (reason) => {
                    if (botData.antiAfkInterval) clearInterval(botData.antiAfkInterval);
                    botData.status = 'Rozłączony';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Rozłączony (${reason})`, type: 'error' });
                });

            } catch (err) {
                console.error(`Błąd tworzenia bota: ${err.message}`);
            }
        }, i * 1500);
    }
}

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
