import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

import { config } from './config.js';
import { getNormalizedMediaMessage, getMediaFileName, saveMedia } from './utils.js';

// Cache for participating group metadata: JID -> Subject
const groupMap = new Map();

async function startBot() {
    // Ensure media storage folder exists
    if (!fs.existsSync(config.mediaDir)) {
        fs.mkdirSync(config.mediaDir, { recursive: true });
        console.log(`[Init] Created media directory matching configuration: ${config.mediaDir}`);
    }

    console.log('[Init] Initializing WhatsApp bot session...');

    // Load or initialize authentication state files
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // Setup logger using configured level (suppressing verbose Baileys traces)
    const logger = pino({ level: config.logLevel || 'info' });

    // Handle default/named ESM import interop for makeWASocket
    const makeWASocketFn = makeWASocket.default || makeWASocket;

    // Instantiate socket connection
    const sock = makeWASocketFn({
        auth: state,
        printQRInTerminal: false, // We print manually to customize look/size
        logger,
    });

    // Save auth credentials whenever they update
    sock.ev.on('creds.update', saveCreds);

    // Monitor connection states
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Print QR code for terminal scanning
        if (qr) {
            console.log('\n┌────────────────────────────────────────────────────────┐');
            console.log('│             ACTION REQUIRED: SCAN WHATSAPP QR          │');
            console.log('└────────────────────────────────────────────────────────┘');
            qrcode.generate(qr, { small: true });
            console.log('Open WhatsApp on your mobile device, tap Link a Device, and scan.');
            console.log('----------------------------------------------------------\n');
        }

        // Handle connection close event
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`\n⚠️ [Connection Event] Closed. Status code: ${statusCode || 'unknown'}. Reconnecting: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(startBot, 5000);
            } else {
                console.log('❌ Session closed permanently (Logged out). Delete "auth_info" directory to scan again.');
                process.exit(1);
            }
        } 
        // Handle connection open event
        else if (connection === 'open') {
            console.log('\n========================================================');
            console.log('🟢 SUCCESS: Connected to WhatsApp Web Gateway!');
            console.log('========================================================\n');

            // Fetch and catalogue all participating group chats
            try {
                console.log('[Sync] Fetching active joined groups details...');
                const groups = await sock.groupFetchAllParticipating();
                const groupEntries = Object.entries(groups);

                console.log('\n--- Enrolled Group Chats List ---');
                if (groupEntries.length === 0) {
                    console.log(' (You are not in any WhatsApp groups currently)');
                } else {
                    for (const [jid, metadata] of groupEntries) {
                        console.log(`📁 Group Subject : "${metadata.subject}"`);
                        console.log(`   └─ Group JID  : ${jid}\n`);
                        groupMap.set(jid, metadata.subject);
                    }
                }
                console.log('---------------------------------\n');
                
                // Announce bot configuration rules
                if (config.targetGroupJid) {
                    console.log(`🎯 Bot Target Config: Monitoring specific JID [ ${config.targetGroupJid} ]`);
                } else if (config.targetGroupSubject) {
                    console.log(`🎯 Bot Target Config: Monitoring group match with Subject [ "${config.targetGroupSubject}" ]`);
                } else {
                    console.log('⚠️  Bot Target Config: NO filter group target defined in .env.');
                    console.log('   The bot is in dry-run directory listing mode. Specify configurations and restart.');
                }
                console.log('📂 Downloads destination directory:', config.mediaDir);
                console.log('\n🤖 Bot is active, listening for incoming group media messages...');
            } catch (err) {
                console.error('⚠️  Failed to retrieve group metadata:', err.message);
            }
        }
    });

    // Process incoming message events
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Only trigger on actual direct notifications (upserts)
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Discard system updates without actual contents or keys
            if (!msg.message || !msg.key) continue;

            const remoteJid = msg.key.remoteJid;
            
            // Only monitor values within group chats (@g.us)
            if (!remoteJid || !remoteJid.endsWith('@g.us')) {
                continue;
            }

            // Dynamically resolve and cache new groups encountered at runtime
            if (!groupMap.has(remoteJid)) {
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    if (metadata && metadata.subject) {
                        groupMap.set(remoteJid, metadata.subject);
                        console.log(`📁 [Dynamic Discovery] Enrolled group: "${metadata.subject}" (${remoteJid})`);
                    }
                } catch (err) {
                    logger.debug(`Could not resolve group metadata details for JID ${remoteJid}: ${err.message}`);
                }
            }

            const groupSubject = groupMap.get(remoteJid) || '';

            // Verify if the group qualifies as the bot's target group
            let isTarget = false;
            if (config.targetGroupJid && remoteJid === config.targetGroupJid) {
                isTarget = true;
            } else if (config.targetGroupSubject && groupSubject.toLowerCase() === config.targetGroupSubject.toLowerCase()) {
                isTarget = true;
            }

            // Skip message if not targeted
            if (!isTarget) continue;

            // Extract and clean media contents
            const normalizedMedia = getNormalizedMediaMessage(msg);
            if (!normalizedMedia) continue;

            const { type: mediaType, content, virtualMsg } = normalizedMedia;
            const sender = msg.key.participant || remoteJid;
            const senderName = msg.pushName || sender.split('@')[0];

            // Resolve file name details
            const fileName = getMediaFileName(
                content,
                mediaType,
                sender,
                msg.key.id,
                msg.messageTimestamp
            );
            const destPath = path.join(config.mediaDir, fileName);

            console.log(`\n📥 [Media Discovered]`);
            console.log(`   📍 Room:   "${groupSubject}" (${remoteJid})`);
            console.log(`   👤 Sender: "${senderName}" (${sender})`);
            console.log(`   📦 Type:   ${mediaType}`);
            console.log(`   💾 Saving: ${fileName}`);

            try {
                // Fetch direct decrypted media stream using Baileys helper on virtual message
                const stream = await downloadMediaMessage(
                    virtualMsg,
                    'stream',
                    {},
                    {
                        logger,
                        reuploadRequest: sock.updateMediaMessage
                    }
                );

                // Pipe decrypter output stream cleanly into target file folder
                await saveMedia(stream, destPath);
                console.log(`✅ [Download Success] File saved to target folder.\n`);
            } catch (err) {
                console.error(`❌ [Download Error] Failed during file parsing or decryption: ${err.message}\n`);
            }
        }
    });
}

// Start bot
startBot().catch((err) => {
    console.error('Fatal initialization error:', err);
});
