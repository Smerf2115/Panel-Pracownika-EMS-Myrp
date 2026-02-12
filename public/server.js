require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const app = express();
app.set('trust proxy', 1);

// Zmienne środowiskowe
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;

const LOG_CHANNELS = {
    plus: '1462235422041051351',
    minus: '1462235907041267835',
    pochwala: '1462236205470191774',
    upomnienie: '1464977210585649162',
    nagana: '1462235976733692045',
    zawieszenie: '1462235799759224853',
    raport: '1470745817693425788',
    urlop: '1387216856686919690',
    wezwanie: '1393704033377587200',
};

async function sendLog(guild, channelKey, embed, ping = null) {
    try {
        const channel = await guild.channels.fetch(LOG_CHANNELS[channelKey]);
        if (channel) {
            const messageData = { embeds: [embed] };
            if (ping) messageData.content = ping;
            await channel.send(messageData);
        }
    } catch (err) {
        console.warn(`Log error [${channelKey}]:`, err.message);
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

const ROLE_PROGRESSION = {
    plus: ['1361688150040248370', '1361688142880440330', '1361688136429600989'],
    minus: ['1361688178595201064', '1361688172802605218', '1361688165093736528'],
    nagana: ['1408554798541701243', '1408554854888247466']
};

const SPECIAL_ROLES = {
    zawieszenie: '1466957208917905665',
    upomnienie: '1361686285529514024',
    pochwala: '1361686292044005377',
};

const path = require('path');

app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    },
    // Memory store jest OK dla małych aplikacji
    // Dla większych użyj connect-redis lub connect-mongo
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

let membersCache = null;
let lastFetchTime = 0;
let isFetching = false;
const CACHE_DURATION = 10 * 60 * 1000;

async function getEMSMembers(forceRefresh = false) {
    const now = Date.now();
    
    if (!forceRefresh && membersCache && (now - lastFetchTime) < CACHE_DURATION) {
        return membersCache;
    }

    if (isFetching) {
        let attempts = 0;
        while (isFetching && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 200));
            attempts++;
        }
        if (membersCache) return membersCache;
    }

    isFetching = true;

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        
        const members = await guild.members.fetch({ 
            force: false,
            withPresences: false
        });

        const filteredMembers = members.filter(m => 
            m.roles.cache.some(r => medicalRanksIds.includes(r.id))
        );

        const data = filteredMembers.map(m => ({
            id: m.id,
            username: m.displayName,
            avatar: m.user.displayAvatarURL({ dynamic: true, size: 256 }),
            status: 'offline',
            rank: m.roles.cache.find(r => r.name.includes('⁝'))?.name || m.roles.highest.name,
            allRoles: m.roles.cache.map(r => ({ id: r.id, name: r.name }))
        }));

        membersCache = data;
        lastFetchTime = now;
        isFetching = false;
        
        return data;
    } catch (e) {
        isFetching = false;
        
        if (membersCache) {
            return membersCache;
        }
        
        throw e;
    }
}

client.login(BOT_TOKEN);

client.on('ready', async () => {
    console.log(`✅ Bot: ${client.user.tag}`);
    
    setTimeout(async () => {
        try {
            await getEMSMembers(true);
            console.log('✅ Cache ready');
        } catch (e) {
            console.error('⚠️ Cache error:', e.message);
        }
    }, 5000);
});

app.get('/api/ems-members', async (req, res) => {
    try {
        const data = await getEMSMembers();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/mia-action', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { targetIds, type, reason } = req.body;

    if (!targetIds || !Array.isArray(targetIds) || targetIds.length === 0 || !type || !reason) {
        return res.status(400).json({ error: 'Missing data' });
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
        const adminMention = `<@${req.session.user.id}>`;

        let successCount = 0;
        let errors = [];

        for (const targetId of targetIds) {
            try {
                const member = await guild.members.fetch(targetId);

                if (!member) {
                    errors.push(`Not found: ${targetId}`);
                    continue;
                }

                const currentRoles = member.roles.cache;
                const targetMention = `<@${targetId}>`;
                let actionDescription = '';

                if (type === 'wezwanie') {
                    const embed = new EmbedBuilder()
                        .setColor(0xf59e0b)
                        .setTitle('📢 Wezwanie do Biura')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();

                    await sendLog(guild, 'wezwanie', embed, targetMention);
                    successCount++;
                    continue;
                }

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
                        errors.push(`${member.displayName} - max+`);
                        continue;
                    }

                    const nextRole = progression[currentLevel + 1];
                    for (const roleId of progression) {
                        if (currentRoles.has(roleId)) await member.roles.remove(roleId);
                    }
                    await member.roles.add(nextRole);
                    actionDescription = `Plus x${currentLevel + 2}`;
                }

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
                        errors.push(`${member.displayName} - max-`);
                        continue;
                    }

                    const nextRole = progression[currentLevel + 1];
                    for (const roleId of progression) {
                        if (currentRoles.has(roleId)) await member.roles.remove(roleId);
                    }
                    await member.roles.add(nextRole);
                    actionDescription = `Minus x${currentLevel + 2}`;
                }

                else if (type === 'nagana') {
                    const progression = ROLE_PROGRESSION.nagana;
                    let currentLevel = -1;
                    for (let i = progression.length - 1; i >= 0; i--) {
                        if (currentRoles.has(progression[i])) {
                            currentLevel = i;
                            break;
                        }
                    }

                    if (currentLevel >= progression.length - 1) {
                        errors.push(`${member.displayName} - max nagana`);
                        continue;
                    }

                    const nextRole = progression[currentLevel + 1];
                    for (const roleId of progression) {
                        if (currentRoles.has(roleId)) await member.roles.remove(roleId);
                    }
                    await member.roles.add(nextRole);
                    actionDescription = `Nagana x${currentLevel + 2}`;
                }

                else if (type === 'upomnienie') {
                    const roleId = SPECIAL_ROLES.upomnienie;
                    if (!currentRoles.has(roleId)) {
                        await member.roles.add(roleId);
                    }
                    actionDescription = 'Upomnienie';
                }

                else if (type === 'zawieszenie') {
                    const roleId = SPECIAL_ROLES.zawieszenie;
                    await member.roles.add(roleId);
                    actionDescription = 'Zawieszenie';
                }

                else if (type === 'pochwala') {
                    const roleId = SPECIAL_ROLES.pochwala;
                    if (!currentRoles.has(roleId)) {
                        await member.roles.add(roleId);
                    }
                    actionDescription = 'Pochwała';
                }

                let logEmbed;

                if (type === 'plus') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0x22c55e)
                        .setTitle('✅ Plus')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '📊', value: actionDescription, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();
                } else if (type === 'minus') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0xdc2626)
                        .setTitle('❌ Minus')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '📊', value: actionDescription, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();
                } else if (type === 'pochwala') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0x06b6d4)
                        .setTitle('🏅 Pochwała')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();
                } else if (type === 'upomnienie') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0xf59e0b)
                        .setTitle('⚠️ Upomnienie')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();
                } else if (type === 'nagana') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0xea580c)
                        .setTitle('🔴 Nagana')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '📊', value: actionDescription, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();
                } else if (type === 'zawieszenie') {
                    logEmbed = new EmbedBuilder()
                        .setColor(0x7f1d1d)
                        .setTitle('🚫 Zawieszenie')
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '👤', value: `${targetMention}\n${member.displayName}`, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            { name: '📝', value: reason },
                            { name: '🔰', value: adminMention, inline: true },
                            { name: '🕐', value: now, inline: true }
                        )
                        .setFooter({ text: 'MIA EMS' })
                        .setTimestamp();
                }

                if (logEmbed) {
                    await sendLog(guild, type, logEmbed);
                }

                successCount++;

            } catch (err) {
                errors.push(`${targetId}: ${err.message}`);
            }
        }

        if (successCount > 0) {
            res.json({ 
                success: true, 
                message: `OK: ${successCount}`,
                successCount,
                errors: errors.length > 0 ? errors : null
            });
        } else {
            res.status(400).json({ 
                error: 'Failed',
                errors 
            });
        }

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/send-report', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    const { type, description } = req.body;
    if (!description) return res.status(400).json({ error: 'No description' });

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

        const typeColors = {
            'Patrol': 0x3b82f6,
            'Operacja': 0xec4899,
            'Wezwanie': 0xf59e0b,
            'Zabezpieczenie': 0x10b981,
        };
        const typeEmoji = {
            'Patrol': '🚑',
            'Operacja': '🔬',
            'Wezwanie': '🚨',
            'Zabezpieczenie': '🛡️',
        };

        const embed = new EmbedBuilder()
            .setColor(typeColors[type] || 0x3b82f6)
            .setTitle(`${typeEmoji[type] || '📝'} Raport — ${type}`)
            .addFields(
                { name: '👤', value: `<@${req.session.user.id}>`, inline: true },
                { name: '🏷️', value: type, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '📋', value: description },
                { name: '🕐', value: now, inline: true }
            )
            .setFooter({ text: 'MIA EMS' })
            .setTimestamp();

        await sendLog(guild, 'raport', embed);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/holiday', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    const { endDate, reason } = req.body;

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('📅 Urlop')
            .addFields(
                { name: '👤', value: `<@${req.session.user.id}>`, inline: true },
                { name: '📅', value: endDate || 'N/A', inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '💬', value: reason || 'N/A' },
                { name: '🕐', value: now, inline: true }
            )
            .setFooter({ text: 'MIA EMS' })
            .setTimestamp();

        await sendLog(guild, 'urlop', embed);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.members.read`;
    res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    
    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        const response = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: CLIENT_ID, 
                client_secret: CLIENT_SECRET, 
                code,
                grant_type: 'authorization_code', 
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${response.data.access_token}` }
        });

        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const member = await guild.members.fetch(userRes.data.id);
            userRes.data.allRoles = member.roles.cache.map(r => ({ id: r.id, name: r.name }));

            const HIGH_COMMAND_ROLE_ID = '1361682897190260903';
            const MIA_ROLE_ID = '1361684141984321556';
            userRes.data.isZarzad = member.roles.cache.has(HIGH_COMMAND_ROLE_ID);
            userRes.data.isMIA = member.roles.cache.has(MIA_ROLE_ID);
        } catch (roleErr) {
            userRes.data.allRoles = [];
            userRes.data.isZarzad = false;
            userRes.data.isMIA = false;
        }

        req.session.user = userRes.data;
        
        req.session.save((err) => {
            if (err) {
                return res.redirect('/?error=session');
            }
            
            setTimeout(() => {
                res.redirect('/');
            }, 100);
        });
        
    } catch (e) {
        res.redirect('/?error=auth');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/api/user', (req, res) => res.json(req.session.user || null));

// Debug endpoint
app.get('/debug', (req, res) => {
    const fs = require('fs');
    const publicPath = path.join(__dirname, 'public');
    try {
        const files = fs.readdirSync(publicPath);
        res.json({
            publicPath,
            files,
            exists: fs.existsSync(publicPath)
        });
    } catch (e) {
        res.json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
});
