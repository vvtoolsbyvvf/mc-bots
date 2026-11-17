const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Boty dzialaja 24/7!\n');
});

const io = new Server(server, { cors: { origin: "*" } });
const activeBots = new Map();

io.on('connection', (socket) => {
    socket.on('start-bots', ({ ip, count, names, antiAfk }) => {
        const [host, port] = ip.split(':');
        for (let i = 0; i < count; i++) {
            const username = (names && names[i]) ? names[i] : `Bot_${Math.floor(Math.random() * 8999 + 1000)}`;
            try {
                const bot = mineflayer.createBot({
                    host: host || ip,
                    port: port ? parseInt(port) : 25565,
                    username: username,
                    auth: 'offline'
                });

                activeBots.set(username, bot);

                bot.on('spawn', () => {
                    socket.emit('bot-log', { text: `[${username}] Dołączył do ${ip}!`, type: 'success' });
                    setTimeout(() => {
                        bot.chat('/register #Hjaslo67 #Hjaslo67');
                        bot.chat('/login #Hjaslo67');
                    }, 1500);
                });

                bot.on('chat', (user, msg) => {
                    socket.emit('bot-log', { text: `<${user}> ${msg}`, type: 'chat' });
                });

                bot.on('end', (reason) => {
                    socket.emit('bot-log', { text: `[${username}] Rozłączono: ${reason}`, type: 'error' });
                    activeBots.delete(username);
                });

                if (antiAfk) {
                    setInterval(() => {
                        if (bot && bot.entity) {
                            bot.setControlState('jump', true);
                            setTimeout(() => bot.setControlState('jump', false), 250);
                        }
                    }, 35000);
                }
            } catch (e) {
                socket.emit('bot-log', { text: `Błąd ${username}: ${e.message}`, type: 'error' });
            }
        }
    });

    socket.on('stop-bots', () => {
        activeBots.forEach((bot) => bot.quit());
        activeBots.clear();
        socket.emit('bot-log', { text: 'Wszystkie boty zatrzymane.', type: 'error' });
    });
});

server.listen(process.env.PORT || 3000);