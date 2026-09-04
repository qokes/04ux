const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==========================================
// 🚨 TU BILLETERA BTC PERSONAL REAL 🚨
// ==========================================
const MY_PERSONAL_BTC_WALLET = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"; 
const verifiedTransactions = new Set();

// Control de dispositivos activos (1 sesión por UX)
const activeSessions = new Map(); // uxNumber -> socketId

function verifyBitcoinTransaction(txid, callback) {
    if (verifiedTransactions.has(txid)) return callback(false, "TXID already used.");
    const url = `https://blockstream.info/api/tx/${txid}`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const tx = JSON.parse(data);
                if (!tx || !tx.vout) return callback(false, "Invalid transaction.");
                let isValid = false, total = 0;
                tx.vout.forEach(out => {
                    if (out.scriptpubkey_address === MY_PERSONAL_BTC_WALLET) {
                        isValid = true;
                        total += out.value;
                    }
                });
                if (!isValid) return callback(false, "Wallet address mismatch.");
                if (total < 5000) return callback(false, "Insufficient amount.");
                verifiedTransactions.add(txid);
                callback(true, "Verified.");
            } catch (e) { callback(false, "Parsing error."); }
        });
    }).on('error', () => callback(false, "Network error."));
}

app.post('/api/verify-payment', (req, res) => {
    const { txid, user, pass } = req.body;
    if (user === "0" && pass === "197126") {
        return res.json({ success: true, downloadUrl: "/download/04ux-system-package.zip" });
    }
    if (!txid) return res.status(400).json({ success: false, message: "TXID required." });
    verifyBitcoinTransaction(txid, (success, message) => {
        if (success) res.json({ success: true, downloadUrl: "/download/04ux-system-package.zip" });
        else res.status(400).json({ success: false, message });
    });
});

app.post('/api/generate-boss-link', (req, res) => {
    const { user, pass } = req.body;
    if (user !== "0" || pass !== "197126") return res.status(403).json({ success: false });
    res.json({ success: true, inviteLink: `/download/04ux-system-package.zip?token=VIP_${Date.now()}` });
});

app.get('/download/04ux-system-package.zip', (req, res) => {
    const zipData = Buffer.from("PK\x03\x04\x14\x00\x00\x00\x08\x00" + "04UX_SYSTEM_CORE_BINARY_DATA".repeat(80));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=04UX-System.zip');
    res.send(zipData);
});

// GESTIÓN DE RED Y ESTADOS EN VIVO (VERDE / ROJO)
io.on('connection', (socket) => {
    socket.on('register_presence', (uxNumber) => {
        // Validar restricción de 1 solo dispositivo por usuario
        if (activeSessions.has(uxNumber)) {
            const oldSocketId = activeSessions.get(uxNumber);
            io.to(oldSocketId).emit('forced_logout', 'Session opened on another device.');
        }
        
        activeSessions.set(uxNumber, socket.id);
        socket.uxNumber = uxNumber;
        socket.join(`ux_${uxNumber}`);
        
        // Broadcast a toda la red que este usuario está en línea (Luz Verde)
        io.emit('update_status', { ux: uxNumber, online: true });
    });

    socket.on('private_chat', (data) => {
        const packet = { 
            senderUx: data.senderUx, 
            targetUx: data.targetUx, 
            text: data.text, 
            time: new Date().toLocaleTimeString() 
        };
        
        if (data.targetUx && data.targetUx.trim() !== "") {
            // Enviar al destinatario y al propio emisor al instante
            io.to(`ux_${data.targetUx.trim()}`).to(`ux_${data.senderUx}`).emit('incoming_message', packet);
        } else {
            io.emit('incoming_message', packet);
        }
    });

    socket.on('disconnect', () => {
        if (socket.uxNumber) {
            activeSessions.delete(socket.uxNumber);
            // Notificar que se desconectó (Luz Roja)
            io.emit('update_status', { ux: socket.uxNumber, online: false });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server online on port ${PORT}`);
});
