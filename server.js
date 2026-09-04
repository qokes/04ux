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

const OFFICIAL_BTC_WALLET = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"; 
const verifiedTransactions = new Set();

function verifyBitcoinTransaction(txid, callback) {
    if (verifiedTransactions.has(txid)) {
        return callback(false, "TXID already used.");
    }

    const url = `https://blockstream.info/api/tx/${txid}`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const tx = JSON.parse(data);
                if (!tx || !tx.vout) return callback(false, "Invalid transaction.");

                let isValid = false;
                let total = 0;
                tx.vout.forEach(out => {
                    if (out.scriptpubkey_address === OFFICIAL_BTC_WALLET) {
                        isValid = true;
                        total += out.value;
                    }
                });

                if (!isValid) return callback(false, "Wallet address mismatch.");
                if (total < 5000) return callback(false, "Insufficient amount.");

                verifiedTransactions.add(txid);
                callback(true, "Verified.");
            } catch (e) {
                callback(false, "Parsing error.");
            }
        });
    }).on('error', () => callback(false, "Network error."));
}

app.post('/api/verify-payment', (req, res) => {
    const { txid, user, pass } = req.body;
    if (user === "0" && pass === "197126") {
        return res.json({ success: true, downloadUrl: "/download/04ux-secure-system-package.zip" });
    }
    if (!txid) return res.status(400).json({ success: false, message: "TXID required." });

    verifyBitcoinTransaction(txid, (success, message) => {
        if (success) {
            res.json({ success: true, downloadUrl: "/download/04ux-secure-system-package.zip" });
        } else {
            res.status(400).json({ success: false, message });
        }
    });
});

app.post('/api/generate-boss-link', (req, res) => {
    const { user, pass } = req.body;
    if (user !== "0" || pass !== "197126") return res.status(403).json({ success: false });
    res.json({ success: true, inviteLink: `/download/04ux-secure-system-package.zip?token=VIP_${Date.now()}` });
});

app.get('/download/04ux-secure-system-package.zip', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename=04UX-Secure-System.zip');
    res.send("04UX PROTOCOL SECURE PACKAGE - FOUNDER: LENOX JG");
});

// GESTIÓN DE CHAT PRIVADO DIRECTO ENTRE NODOS UX
io.on('connection', (socket) => {
    socket.on('join_ux', (uxNumber) => {
        socket.uxNumber = uxNumber;
        socket.join(`ux_${uxNumber}`);
    });

    socket.on('private_chat', (data) => {
        // data: { senderUx, targetUx, text }
        const packet = { sender: `UX ${data.senderUx}`, text: data.text, time: new Date().toLocaleTimeString() };
        
        if (data.targetUx && data.targetUx.trim() !== "") {
            // Enviar específicamente al usuario destino y al propio remitente
            io.to(`ux_${data.targetUx.trim()}`).to(`ux_${data.senderUx}`).emit('incoming_message', packet);
        } else {
            // Broadcast general si no se especifica número destino
            io.emit('incoming_message', packet);
        }
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`04UX Server running stable on port ${PORT}`);
});
