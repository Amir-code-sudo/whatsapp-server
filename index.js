const express = require('express');
const cors = require('cors');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

// To store QR codes and connection status in memory for this simple version
const sessions = {};

// Start WhatsApp connection for a specific user ID
async function startWhatsApp(userId) {
    console.log(`Starting WhatsApp session for user: ${userId}`);
    const { state, saveCreds } = await useMultiFileAuthState(`auth_info_baileys/${userId}`);
    
    sessions[userId] = { status: 'initializing', qr: null, sock: null };

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: "silent" })
    });

    sessions[userId].sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log(`New QR Code generated for user: ${userId}`);
            // Convert QR to Base64 image
            sessions[userId].qr = await QRCode.toDataURL(qr);
            sessions[userId].status = 'qr_ready';
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed for ${userId}. Reconnecting: ${shouldReconnect}`);
            sessions[userId].status = 'disconnected';
            sessions[userId].qr = null;
            if (shouldReconnect) {
                startWhatsApp(userId);
            }
        } else if (connection === 'open') {
            console.log(`Connection opened successfully for user: ${userId}`);
            sessions[userId].status = 'connected';
            sessions[userId].qr = null;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Simple extraction logic - you can improve this later
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        // Very basic check to see if it looks like an order (contains 'الاسم' and 'التليفون')
        if (text.includes('الاسم') && (text.includes('تليفون') || text.includes('هاتف'))) {
            console.log(`[!] NEW ORDER DETECTED for user ${userId}:`, text);
            // TODO: Here we will connect to Firebase and save the invoice
        }
    });
}

// API Endpoints
app.get('/', (req, res) => {
    res.send('WhatsApp Sync Server is running!');
});

// Endpoint to request a QR Code
app.get('/api/wa/start/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    if (!sessions[userId] || sessions[userId].status === 'disconnected') {
        startWhatsApp(userId);
        res.json({ success: true, message: 'Starting session, please poll for QR code.' });
    } else {
        res.json({ success: true, status: sessions[userId].status, qr: sessions[userId].qr });
    }
});

// Endpoint to check status
app.get('/api/wa/status/:userId', (req, res) => {
    const userId = req.params.userId;
    if (!sessions[userId]) {
        return res.json({ status: 'not_started' });
    }
    res.json({ 
        status: sessions[userId].status, 
        qr: sessions[userId].qr 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
