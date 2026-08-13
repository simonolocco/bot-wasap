import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

async function getGroups() {
    console.log('\n🔄 Iniciando conexión para obtener JIDs de todos tus grupos de WhatsApp...\n');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const makeWASocketFn = makeWASocket.default || makeWASocket;

    const sock = makeWASocketFn({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log('📱 Escanea este código QR con tu WhatsApp para listar tus grupos:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('\n✅ ¡Conectado exitosamente a WhatsApp Web!\n');
            try {
                const groups = await sock.groupFetchAllParticipating();
                const groupList = Object.values(groups);

                console.log(`📋 Encontré ${groupList.length} grupos activos:\n`);
                console.log('='.repeat(65));
                
                groupList.forEach(group => {
                    console.log(`📁 Nombre: ${group.subject}`);
                    console.log(`🔑 JID:    ${group.id}`);
                    console.log('─'.repeat(65));
                });

                console.log('\n💡 Copia el JID (terminado en @g.us) del grupo que desees y pégalo en tu .env o Render:');
                console.log('TARGET_GROUP_NAME="120363xxxxxxxxxx@g.us"\n');
                
                setTimeout(() => process.exit(0), 1000);
            } catch (err) {
                console.error('Error al listar grupos:', err);
                process.exit(1);
            }
        }
    });
}

getGroups();
