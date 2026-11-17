const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let activeBots = [];

io.on('connection', (socket) => {
    console.log(`[Backend] Nowy klient polaczony z panelem: ${socket.id}`);

    // Wysyłamy status startowy
    socket.emit('bot-log', { text: '[System] Polaczono pomyslnie z serwerem backendowym w chmurze.', type: 'success' });
    updateClients(io);

    // Uruchamianie botów
    socket.on('start-bots', (data) => {
        const { ip, count, names, antiAfk } = data;
        const [host, port] = ip.split(':');
        const serverPort = port ? parseInt(port) : 25565;

        console.log(`[BotManager] Otrzymano żądanie uruchomienia ${count} botow dla ${ip} przez klienta ${socket.id}`);
        io.emit('bot-log', { text: `[System] Rozpoczynam spawn ${count} botow na adres ${host}:${serverPort}...`, type: 'info' });

        const RANDOM_PREFIXES = ['Kacper', 'Bartek', 'Stasiek', 'Mat', 'Pro', 'Xx', 'Super', 'Hyper', 'Shadow', 'Craft', 'Builder'];
        
        for (let i = 0; i < count; i++) {
            let botName = names && names[i] ? names[i] : `${RANDOM_PREFIXES[Math.floor(Math.random() * RANDOM_PREFIXES.length)]}${Math.floor(Math.random() * 900) + 100}`;
            
            // Sprawdzenie czy bot już nie działa
            if (activeBots.some(b => b.name === botName)) {
                botName = `${botName}_${i}`;
            }

            try {
                const bot = mineflayer.createBot({
                    host: host,
                    port: serverPort,
                    username: botName,
                    version: false // Automatyczne wykrywanie wersji serwera
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

                bot.on('spawn', () => {
                    botData.status = 'W grze (Aktywny)';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Sukces! Bot dołaczyl do serwera ${host}:${serverPort}.`, type: 'success' });

                    // Logika Anti-AFK
                    if (antiAfk) {
                        botData.antiAfkInterval = setInterval(() => {
                            try {
                                bot.setControlState('jump', true);
                                setTimeout(() => bot.setControlState('jump', false), 500);
                                io.emit('bot-log', { text: `[Anti-AFK] Bot [${botName}] wykonuje ruch zapobiegajacy wyrzuceniu.`, type: 'antiafk' });
                            } catch (e) {
                                console.error(`[Anti-AFK Error] ${botName}:`, e.message);
                            }
                        }, 35000);
                    }
                });

                bot.on('chat', (username, message) => {
                    if (username === botName) return;
                    io.emit('bot-log', { text: `<${username}> ${message}`, type: 'chat' });
                });

                bot.on('kicked', (reason) => {
                    botData.status = 'Wyrzucony (Kicked)';
                    updateClients(io);
                    // Próbujemy sparsować powód wyrzucenia z serwera
                    let cleanReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
                    io.emit('bot-log', { text: `[${botName}] Zostal wyrzucony z serwera! Powód: ${cleanReason}`, type: 'error' });
                });

                bot.on('error', (err) => {
                    botData.status = 'Blad polaczenia';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Blad krytyczny mineflayer: ${err.message}`, type: 'error' });
                });

                bot.on('end', (reason) => {
                    if (botData.antiAfkInterval) clearInterval(botData.antiAfkInterval);
                    botData.status = 'Rozlaczony';
                    updateClients(io);
                    io.emit('bot-log', { text: `[${botName}] Rozlaczony z serwera. Powód: ${reason}`, type: 'error' });
                });

            } catch (err) {
                io.emit('bot-log', { text: `[System] Nie udało sie utworzyc instancji bota ${botName}: ${err.message}`, type: 'error' });
            }
        }
    });

    // Obsługa komend wysyłanych z konsoli panelu
    socket.on('console-command', (data) => {
        const { message } = data;
        if (!message) return;

        io.emit('bot-log', { text: `[Panel -> Boty] Wysylam komende/wiadomosc: ${message}`, type: 'chat' });

        activeBots.forEach(b => {
            if (b.instance && b.status.includes('W grze')) {
                if (message.startsWith('/')) {
                    b.instance.chat(message);
                } else {
                    b.instance.chat(message);
                }
            }
        });
    });

    // Zatrzymywanie botów
    socket.on('stop-bots', () => {
        console.log(`[BotManager] Zatrzymywanie wszystkich botow przez klienta ${socket.id}`);
        stopAllBots();
        io.emit('bot-log', { text: '[System] Wszystkie boty zostały zatrzymane i usunięte z pamieci.', type: 'error' });
        updateClients(io);
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient odłączony: ${socket.id}`);
    });
});

function stopAllBots() {
    activeBots.forEach(b => {
        if (b.antiAfkInterval) clearInterval(b.antiAfkInterval);
        try {
            b.instance.quit();
        } catch (e) {}
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Backend] Serwer ruszył na porcie ${PORT}`);
});
