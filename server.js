require('dotenv').config();

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;


// ─── KANAŁY LOGÓW ────────────────────────────────────────────────────────────
const LOG_CHANNELS = {
    plus:        '1462235422041051351',
    minus:       '1462235907041267835',
    pochwala:    '1462236205470191774',
    upomnienie:  '1464977210585649162',
    nagana:      '1462235976733692045',
    zawieszenie: '1462235799759224853',
    raport:      '1470745817693425788',
    urlop:       '1387216856686919690',
    wezwanie:    '1393704033377587200',
};

// Helper: wyślij embed na konkretny kanał
async function sendLog(guild, channelKey, embed, ping = null) {
    try {
        const channel = await guild.channels.fetch(LOG_CHANNELS[channelKey]);
        if (channel) {
            const messageData = { embeds: [embed] };
            if (ping) messageData.content = ping;
            await channel.send(messageData);
        }
    } catch (err) {
        console.warn(`Nie udało się wysłać loga na kanał [${channelKey}]:`, err.message);
    }
}

const medicalRanksIds = [
    '1361688117311963216', '1361682698963259522', '1361682855645675720',
    '1361682877062058044', '1361682883479339309', '1361685410186526932',
    '1361685419204542689', '1388915799288320154', '1361685425072242860',
    '1361685459243237518', '1361685464058302585', '1361685471792595245',
    '1361686250335113463', '1361686238821744640', '1361686264302141440',
    '1361686256999989500'
];

// ─── MAPA RÓL PROGRESYWNYCH ───────────────────────────────────────────────────
const ROLE_PROGRESSION = {
    plus: [
        '1361688150040248370', // plus x1
        '1361688142880440330', // plus x2
        '1361688136429600989', // plus x3
    ],
    minus: [
        '1361688178595201064', // minus x1
        '1361688172802605218', // minus x2
        '1361688165093736528', // minus x3
    ],
    nagana: [
        '1408554798541701243', // nagana x1
        '1408554854888247466', // nagana x2
    ]
};

// Uzupełnij poniższe ID ról:
const SPECIAL_ROLES = {
    zawieszenie:  '1466957208917905665', // rola "Zawieszony"
    upomnienie:   '1361686285529514024', // rola "Upomnienie"
    pochwala:     '1361686292044005377', // rola "Pochwała" (opcjonalna)
};

// ─── INICJALIZACJA ───────────────────────────────────────────────────────────
app.use(session({ secret: 'ems-mia-key', resave: false, saveUninitialized: false }));
app.use(express.static('public'));
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

client.login(BOT_TOKEN);

client.on('ready', () => {
    console.log(`✅ Bot zalogowany jako ${client.user.tag}`);
    console.log(`📡 Połączono z serwerem ID: ${GUILD_ID}`);
});

// ─── API: LISTA CZŁONKÓW ──────────────────────────────────────────────────────
app.get('/api/ems-members', async (req, res) => {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        
        // Pobierz WSZYSTKICH członków serwera (nie tylko z cache)
        await guild.members.fetch({ force: true, withPresences: true });
        
        const allMembers = guild.members.cache;
        console.log(`📊 Pobrano ${allMembers.size} członków z serwera`);

        // Filtruj tylko tych z rolami medycznymi
        const filteredMembers = allMembers.filter(m => 
            m.roles.cache.some(r => medicalRanksIds.includes(r.id))
        );
        
        console.log(`🏥 Znaleziono ${filteredMembers.size} członków EMS`);

        const data = filteredMembers.map(m => ({
            id: m.id,
            username: m.displayName,
            avatar: m.user.displayAvatarURL({ dynamic: true, size: 256 }),
            status: m.presence ? m.presence.status : 'offline',
            rank: m.roles.cache.find(r => r.name.includes('⁝'))?.name || m.roles.highest.name,
            allRoles: m.roles.cache.map(r => ({ id: r.id, name: r.name }))
        }));

        res.json(data);
    } catch (e) {
        console.error('❌ Błąd pobierania członków:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─── API: AKCJA MIA (PROGRESYWNA LOGIKA RÓL - WIELOKROTNY WYBÓR) ─────────────
app.post('/api/mia-action', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Nie jesteś zalogowany.' });
    }

    const { targetIds, type, reason } = req.body;

    if (!targetIds || !Array.isArray(targetIds) || targetIds.length === 0 || !type || !reason) {
        return res.status(400).json({ error: 'Brakuje wymaganych danych lub nie wybrano żadnego funkcjonariusza.' });
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
        const adminMention = `<@${req.session.user.id}>`;

        let successCount = 0;
        let errors = [];

        // Iterujemy przez wszystkich wybranych
        for (const targetId of targetIds) {
            try {
                const member = await guild.members.fetch(targetId);

                if (!member) {
                    errors.push(`Nie znaleziono użytkownika ${targetId}`);
                    continue;
                }

                const currentRoles = member.roles.cache;
                const targetMention = `<@${targetId}>`;
                let actionDescription = '';
                let colorHex = 0x3498db;

                // ── WEZWANIE DO BIURA ─────────────────────────────────────────────────
                if (type === 'wezwanie') {
                    const embed = new EmbedBuilder()
                        .setColor(0xf59e0b)
                        .setTitle('📢 Wezwanie do Biura')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Wezwana osoba', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Powód wezwania', value: reason },
                            { name: '🔰 Wezwał', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Wezwań' })
                        .setTimestamp();

                    await sendLog(guild, 'wezwanie', embed, targetMention);
                    successCount++;
                    continue;
                }

                // ── PROGRESJA PLUSÓW ──────────────────────────────────────────────────
                if (type === 'plus') {
                    const progression = ROLE_PROGRESSION.plus;
                    let currentLevel = -1;
                    for (let i = progression.length - 1; i >= 0; i--) {
                        if (currentRoles.has(progression[i])) {
                            currentLevel = i;
                            break;
                        }
                    }

                    if (currentLevel >= progression.length - 1) {
                        errors.push(`${member.displayName} ma już maksymalną liczbę plusów (x3)`);
                        continue;
                    }

                    const nextRole = progression[currentLevel + 1];
                    for (const roleId of progression) {
                        if (currentRoles.has(roleId)) await member.roles.remove(roleId);
                    }
                    await member.roles.add(nextRole);
                    actionDescription = `Nadano **Plus x${currentLevel + 2}**`;
                    colorHex = 0x2ecc71;
                }

                // ── PROGRESJA MINUSÓW ─────────────────────────────────────────────────
                else if (type === 'minus') {
                    const progression = ROLE_PROGRESSION.minus;
                    let currentLevel = -1;
                    for (let i = progression.length - 1; i >= 0; i--) {
                        if (currentRoles.has(progression[i])) {
                            currentLevel = i;
                            break;
                        }
                    }

                    if (currentLevel >= progression.length - 1) {
                        errors.push(`${member.displayName} ma już 3 minusy`);
                        continue;
                    }

                    const nextRole = progression[currentLevel + 1];
                    for (const roleId of progression) {
                        if (currentRoles.has(roleId)) await member.roles.remove(roleId);
                    }
                    await member.roles.add(nextRole);
                    actionDescription = `Nadano **Minus x${currentLevel + 2}**`;
                    colorHex = 0xe74c3c;
                }

                // ── PROGRESJA NAGAN ───────────────────────────────────────────────────
                else if (type === 'nagana') {
                    const progression = ROLE_PROGRESSION.nagana.filter(id => id !== null);
                    if (progression.length === 0) {
                        errors.push('Role nagan nie są skonfigurowane w server.js');
                        continue;
                    }

                    let currentLevel = -1;
                    for (let i = progression.length - 1; i >= 0; i--) {
                        if (currentRoles.has(progression[i])) {
                            currentLevel = i;
                            break;
                        }
                    }

                    if (currentLevel >= progression.length - 1) {
                        errors.push(`${member.displayName} ma już maksymalną naganę`);
                        continue;
                    }

                    const nextRole = progression[currentLevel + 1];
                    for (const roleId of progression) {
                        if (currentRoles.has(roleId)) await member.roles.remove(roleId);
                    }
                    await member.roles.add(nextRole);
                    actionDescription = `Nadano **Naganę x${currentLevel + 2}**`;
                    colorHex = 0xe67e22;
                }

                // ── UPOMNIENIE (jednorazowa rola) ─────────────────────────────────────
                else if (type === 'upomnienie') {
                    const roleId = SPECIAL_ROLES.upomnienie;
                    if (!roleId || roleId.startsWith('WSTAW')) {
                        errors.push('Rola upomnienia nie jest skonfigurowana');
                        continue;
                    }
                    if (!currentRoles.has(roleId)) {
                        await member.roles.add(roleId);
                    }
                    actionDescription = `Wystawiono **Upomnienie**`;
                    colorHex = 0xf39c12;
                }

                // ── ZAWIESZENIE ───────────────────────────────────────────────────────
                else if (type === 'zawieszenie') {
                    const roleId = SPECIAL_ROLES.zawieszenie;
                    await member.roles.add(roleId);
                    actionDescription = `Nałożono **Zawieszenie**`;
                    colorHex = 0x992d22;
                }

                // ── POCHWAŁA ──────────────────────────────────────────────────────────
                else if (type === 'pochwala') {
                    const roleId = SPECIAL_ROLES.pochwala;
                    if (!roleId || roleId.startsWith('WSTAW')) {
                        errors.push('Rola pochwały nie jest skonfigurowana');
                        continue;
                    }
                    if (!currentRoles.has(roleId)) {
                        await member.roles.add(roleId);
                    }
                    actionDescription = `Wystawiono **Pochwałę**`;
                    colorHex = 0x1abc9c;
                }

                else {
                    errors.push('Nieznany typ akcji');
                    continue;
                }

                // ── LOG NA ODPOWIEDNI KANAŁ DISCORD ───────────────────────────────────
                let logEmbed;

                if (type === 'plus') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0x22c55e)
                        .setTitle('✅ Nadano Plus')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Funkcjonariusz', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '📊 Przyznano', value: actionDescription, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Uzasadnienie', value: reason },
                            { name: '🔰 Wystawił', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Plusów' })
                        .setTimestamp();

                } else if (type === 'minus') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0xdc2626)
                        .setTitle('❌ Nadano Minus')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Funkcjonariusz', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '📊 Nałożono', value: actionDescription, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Uzasadnienie', value: reason },
                            { name: '🔰 Wystawił', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Minusów' })
                        .setTimestamp();

                } else if (type === 'pochwala') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0x06b6d4)
                        .setTitle('🏅 Wystawiono Pochwałę')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Funkcjonariusz', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Treść pochwały', value: reason },
                            { name: '🔰 Wystawił', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Pochwał' })
                        .setTimestamp();

                } else if (type === 'upomnienie') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0xf59e0b)
                        .setTitle('⚠️ Wystawiono Upomnienie')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Funkcjonariusz', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Powód upomnienia', value: reason },
                            { name: '🔰 Wystawił', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Dyscyplinarny' })
                        .setTimestamp();

                } else if (type === 'nagana') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0xea580c)
                        .setTitle('🔴 Wystawiono Naganę')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Funkcjonariusz', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '📊 Poziom', value: actionDescription, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Powód nagany', value: reason },
                            { name: '🔰 Wystawił', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Dyscyplinarny' })
                        .setTimestamp();

                } else if (type === 'zawieszenie') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0x7f1d1d)
                        .setTitle('🚫 Zawieszono Funkcjonariusza')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤 Zawieszony', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝 Powód zawieszenia', value: reason },
                            { name: '🔰 Decyzja', value: `${adminMention} (${req.session.user.username})`, inline: true },
                            { name: '🕐 Data', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS — System Zawieszeń' })
                        .setTimestamp();
                }

                if (logEmbed) {
                    await sendLog(guild, type, logEmbed);
                }

                successCount++;

            } catch (err) {
                errors.push(`Błąd przy przetwarzaniu ${targetId}: ${err.message}`);
            }
        }

        // Zwróć podsumowanie
        if (successCount > 0) {
            res.json({ 
                success: true, 
                message: `Pomyślnie przetworzono ${successCount} funkcjonariusz(y)`,
                successCount,
                errors: errors.length > 0 ? errors : null
            });
        } else {
            res.status(400).json({ 
                error: 'Nie udało się przetworzyć żadnego funkcjonariusza',
                errors 
            });
        }

    } catch (e) {
        console.error('Błąd /api/mia-action:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─── WEZWANIE DO BIURA (STARY ENDPOINT - dla kompatybilności) ────────────────
app.post('/api/wezwanie', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Niezalogowany.' });

    const { targetId, reason } = req.body;
    if (!targetId || !reason) return res.status(400).json({ error: 'Brak danych.' });

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(targetId);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
        const targetMention = `<@${targetId}>`;
        const adminMention = `<@${req.session.user.id}>`;

        const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('📢 Wezwanie do Biura')
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 Wezwana osoba', value: `${targetMention}\n${member.displayName}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '📝 Powód wezwania', value: reason },
                { name: '🔰 Wezwał', value: `${adminMention} (${req.session.user.username})`, inline: true },
                { name: '🕐 Data', value: now, inline: true }
            )
            .setFooter({ text: 'MIA EMS — System Wezwań' })
            .setTimestamp();

        await sendLog(guild, 'wezwanie', embed, targetMention);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── RAPORT OPERACYJNY ────────────────────────────────────────────────────────
app.post('/api/send-report', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Niezalogowany.' });

    const { type, description } = req.body;
    if (!description) return res.status(400).json({ error: 'Brak opisu.' });

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

        const typeColors = {
            'Patrol':         0x3b82f6,
            'Operacja':       0xec4899,
            'Wezwanie':       0xf59e0b,
            'Zabezpieczenie': 0x10b981,
        };
        const typeEmoji = {
            'Patrol':         '🚑',
            'Operacja':       '🔬',
            'Wezwanie':       '🚨',
            'Zabezpieczenie': '🛡️',
        };

        const embed = new EmbedBuilder()
            .setColor(typeColors[type] || 0x3b82f6)
            .setTitle(`${typeEmoji[type] || '📝'} Raport Operacyjny — ${type}`)
            .addFields(
                { name: '👤 Funkcjonariusz', value: `<@${req.session.user.id}>\n${req.session.user.username}`, inline: true },
                { name: '🏷️ Typ operacji', value: type, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '📋 Przebieg służby', value: description },
                { name: '🕐 Data i godzina', value: now, inline: true }
            )
            .setFooter({ text: 'MIA EMS — Raporty Operacyjne' })
            .setTimestamp();

        await sendLog(guild, 'raport', embed);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── URLOPY ───────────────────────────────────────────────────────────────────
app.post('/api/holiday', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Niezalogowany.' });

    const { endDate, reason } = req.body;

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('📅 Zgłoszenie Urlopu')
            .addFields(
                { name: '👤 Funkcjonariusz', value: `<@${req.session.user.id}>\n${req.session.user.username}`, inline: true },
                { name: '📅 Urlop do', value: endDate || 'Nieokreślona', inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '💬 Powód', value: reason || 'Nie podano' },
                { name: '🕐 Zgłoszono', value: now, inline: true }
            )
            .setFooter({ text: 'MIA EMS — System Urlopów' })
            .setTimestamp();

        await sendLog(guild, 'urlop', embed);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.members.read`;
    res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const response = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code,
            grant_type: 'authorization_code', redirect_uri: REDIRECT_URI
        }));
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${response.data.access_token}` }
        });

        // Pobierz role użytkownika z serwera
        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const member = await guild.members.fetch(userRes.data.id);
            userRes.data.allRoles = member.roles.cache.map(r => ({ id: r.id, name: r.name }));

            const HIGH_COMMAND_ROLE_ID = '1361682897190260903';
            const MIA_ROLE_ID = '1361684141984321556';
            userRes.data.isZarzad = member.roles.cache.has(HIGH_COMMAND_ROLE_ID);
            userRes.data.isMIA = member.roles.cache.has(MIA_ROLE_ID);
        } catch (roleErr) {
            console.warn('Nie udało się pobrać ról:', roleErr.message);
            userRes.data.allRoles = [];
        }

        req.session.user = userRes.data;
        res.redirect('/');
    } catch (e) {
        console.error('Błąd callback:', e.message);
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server działa na porcie ${PORT}`);
});
