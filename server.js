const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');
const cors = require('cors');

// Zabezpieczenie przed crashem całego procesu Node.js
process.on('uncaughtException', (err) => {
    console.error('[CRASH GUARD] Wyłapano nieobsłużony błąd:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH GUARD] Wyłapano odrzuconą obietnicę:', reason);
});

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('BotManager Safe TCP Online');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let activeConnections = new Set();

io.on('connection', (socket) => {
    console.log(`[Backend] Nowy klient z panela vvTools: ${socket.id}`);

    socket.on('start-bots', (data) => {
        try {
            const { host, port, count, prefix } = data;
            const targetPort = parseInt(port) || 11670;
            const botCount = parseInt(count) || 1;
            const botPrefix = prefix || 'Bot_';

        console.log(`[TCP Test] Bezpieczny start ${botCount} socketów do ${host}:${targetPort}`);
            socket.emit('log', `[System] Bezpieczny tryb TCP: Testuję połączenia do ${host}:${targetPort}...`);

            let launched = 0;

            function connectNext() {
                if (launched >= botCount) return;

                const botName = `${botPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
                socket.emit('log', `[${botName}] Próba nawiązania TCP...`);

                try {
                    const client = new net.Socket();
                    
                    client.setTimeout(10000); // 10 sekund timeoutu na socket

                    client.connect(targetPort, host.trim(), () => {
                        socket.emit('log', `[${botName}] ✅ TCP połączone z Aternosem!`);
                        activeConnections.add(client);
                        socket.emit('bot-count', activeConnections.size);
                    });

                    client.on('timeout', () => {
                        socket.emit('log', `[${botName}] ⚠️ Timeout TCP.`);
                        try { client.destroy(); } catch(e) {}
                    });

                    client.on('error', (err) => {
                        socket.emit('log', `[${botName}] ❌ Błąd TCP: ${err.message}`);
                        try { client.destroy(); } catch(e) {}
                    });

                    client.on('close', () => {
                        activeConnections.delete(client);
                        try { socket.emit('bot-count', activeConnections.size); } catch(e) {}
                    });

                } catch (e) {
                    console.error('[Socket Error]', e.message);
                }

                launched++;
                setTimeout(connectNext, 3000);
            }

            connectNext();

        } catch (err) {
            console.error('[Start-Bots Error]', err.message);
            socket.emit('log', `[System] Błąd krytyczny procedury: ${err.message}`);
        }
    });

    socket.on('stop-bots', () => {
        console.log(`[TCP Test] Zamykanie wszystkich socketów.`);
        activeConnections.forEach((client) => {
            try { client.destroy(); } catch(e) {}
        });
        activeConnections.clear();
        try {
            socket.emit('log', `[System] Zamknięto wszystkie sockety TCP.`);
            socket.emit('bot-count', 0);
        } catch(e) {}
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient rozłączony: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Serwer TCP ruszyl na porcie ${PORT}`);
});
