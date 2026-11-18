const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('BotManager Raw TCP Mode Online');
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

    // Tryb testu surowych socketów TCP (omija całkowicie anty-bota Mineflayera)
    socket.on('start-bots', (data) => {
        const { host, port, count, prefix } = data;
        const targetPort = parseInt(port) || 11670;
        const botCount = parseInt(count) || 1;
        const botPrefix = prefix || 'Bot_';

        console.log(`[TCP Test] Próba otwarcia ${botCount} surowych socketów TCP do ${host}:${targetPort}`);
        socket.emit('log', `[System] Tryb Raw TCP: Testuję połączenia do ${host}:${targetPort}...`);

        let launched = 0;

        function connectNext() {
            if (launched >= botCount) return;

            const botName = `${botPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
            socket.emit('log', `[${botName}] Otwieram surowy socket TCP...`);

            const client = new net.Socket();
            
            client.connect(targetPort, host.trim(), () => {
                socket.emit('log', `[${botName}] ✅ Sukces! Surowy socket TCP połączył się z Aternosem!`);
                activeConnections.add(client);
                socket.emit('bot-count', activeConnections.size);
            });

            client.on('error', (err) => {
                socket.emit('log', `[${botName}] ❌ Błąd TCP / zablokowany: ${err.message}`);
                client.destroy();
            });

            client.on('close', () => {
                activeConnections.delete(client);
                socket.emit('bot-count', activeConnections.size);
            });

            launched++;
            // Odstęp 3 sekundy między surowymi socketami
            setTimeout(connectNext, 3000);
        }

        connectNext();
    });

    socket.on('stop-bots', () => {
        console.log(`[TCP Test] Zamykanie wszystkich socketów.`);
        activeConnections.forEach((client) => {
            try { client.destroy(); } catch(e) {}
        });
        activeConnections.clear();
        socket.emit('log', `[System] Zamknięto wszystkie sockety TCP.`);
        socket.emit('bot-count', 0);
    });

    socket.on('disconnect', () => {
        console.log(`[Backend] Klient rozłączony: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Serwer TCP ruszyl na porcie ${PORT}`);
});
