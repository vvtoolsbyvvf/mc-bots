function spawnBotsBatch(host, port, count, names, antiAfk, socket, io) {
    // Bezpieczny limit maksymalny, żeby nie ubić pamięci Rendera
    const maxBots = Math.min(count, 20); 
    console.log(`[BotManager] Kolejkowanie ${maxBots} botow dla ${host}:${port}`);
    io.emit('bot-log', { text: `[System] Bezpieczny start ${maxBots} botów (po 1 co 2.5 sekundy)...`, type: 'info' });

    const RANDOM_PREFIXES = ['Kacper', 'Bartek', 'Stasiek', 'Mat', 'Pro', 'Xx', 'Super', 'Hyper', 'Shadow', 'Craft', 'Builder'];

    for (let i = 0; i < maxBots; i++) {
        setTimeout(() => {
            if (socket.disconnected && activeBots.length === 0) return;

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
                    skipValidation: true,
                    checkTimeoutInterval: 120000
                });

                bot._client.on('resource_pack_send', (packet) => {
                    bot._client.write('resource_pack_receive', {
                        uuid: packet.uuid,
                        result: 3
                    });
                });

                bot._client.on('connect', () => {
                    bot._client.socket.setKeepAlive(true, 0);
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
                    setTimeout(() => {
                        botData.status = 'W grze';
                        updateClients(io);
                        io.emit('bot-log', { text: `[${botName}] Wbił na serwer!`, type: 'success' });

                        if (antiAfk) {
                            botData.antiAfkInterval = setInterval(() => {
                                try {
                                    bot.setControlState('jump', true);
                                    setTimeout(() => bot.setControlState('jump', false), 400);
                                } catch (e) {}
                            }, 30000);
                        }
                    }, 3000);
                });

                bot.on('kicked', (reason) => {
                    botData.status = 'Wyrzucony';
                    updateClients(io);
                });

                bot.on('error', (err) => {
                    botData.status = 'Błąd';
                    updateClients(io);
                });

                bot.on('end', (reason) => {
                    if (botData.antiAfkInterval) clearInterval(botData.antiAfkInterval);
                    botData.status = 'Rozłączony';
                    updateClients(io);
                });

            } catch (err) {
                console.error(`Błąd: ${err.message}`);
            }
        }, i * 2500); // 2.5 sekundy przerwy między każdym botem
    }
}
