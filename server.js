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

        let cleanInput = ip.trim();
        let targetHost = cleanInput;
        let targetPort = 25565;

        // Jeśli użytkownik wpisał ręcznie z portem (np. aternos:12345)
        if (cleanInput.includes(':')) {
            const parts = cleanInput.split(':');
            targetHost = parts[0];
            targetPort = parseInt(parts[1], 10) || 25565;
            spawnBots(targetHost, targetPort, count, names, antiAfk, socket, io);
        } else {
            // Automatyczne sprawdzanie portu SRV dla Aternosa
            io.emit('bot-log', { text: `[System] Pobieranie danych DNS dla ${targetHost}...`, type: 'info' });
            
            dns.resolveSrv(`_minecraft._tcp.${targetHost}`, (err, addresses) => {
                if (!err && addresses && addresses.length > 0) {
                    targetHost = addresses[0].name;
                    targetPort = addresses[0].port;
                    io.emit('bot-log', { text: `[System] Wykryto port Aternosa: ${targetHost}:${targetPort}`, type: 'success' });
                    spawnBots(targetHost, targetPort, count, names, antiAfk, socket, io);
                } else {
                    io.emit('bot-log', { text: `[System] Brak rekordu SRV, próbuję połączyć się bezpośrednio z ${targetHost}:25565`, type: 'info' });
                    spawnBots(targetHost, 25565, count, names, antiAfk, socket, io);
                }
            });
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

function spawnBots(host, port, count, names, antiAfk, socket, io) {
    console.log(`[BotManager] Uruchamianie ${count} botow dla ${host}:${port}`);
    io.emit('bot-log', { text: `[System] Próba spawnu ${count} botow na ${host}:${port}...`, type: 'info' });

    const RANDOM_PREFIXES = ['Kacper', 'Bartek', 'Stasiek', 'Mat', 'Pro', 'Xx', 'Super', 'Hyper', 'Shadow', 'Craft', 'Builder'];

    for (let i = 0; i < count; i++) {
        let botName = names && names[i] ? names[i] : `${RANDOM_PREFIXES[Math.floor(Math.random() * RANDOM_PREFIXES.length)]}${Math.floor(Math.random() * 900) + 100}`;
        
        if (activeBots.some(b => b.name === botName)) {
            botName = `${botName}_${i}`;
        }

        try {
            const bot = mineflayer.createBot({
                host: host,
                port: port,
                username: botName,
                version: false,
                skipValidation: true
            });

            // Automatyczna akceptacja paczki zasobów od Aternosa/serwera, żeby bot nie zawisł
            bot._client.on('resource_pack_send', (packet) => {
                io.emit('bot-log', { text: `[${botName}] Serwer żąda akceptacji paczki zasobów, akceptuję...`, type: 'info' });
                bot._client.write('resource_pack_receive', {
                    uuid: packet.uuid,
                    result: 3 // 3 = Zaakceptowano i pobrano
                });
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
