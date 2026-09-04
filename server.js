const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// BILLETERA OFICIAL DE LENOX JG
const OFFICIAL_BTC_WALLET = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"; 
const verifiedTransactions = new Set();

function verifyBitcoinTransaction(txid, callback) {
    if (verifiedTransactions.has(txid)) {
        return callback(false, "Transaction ID already used (Anti-Fraud Protection).");
    }

    const url = `https://blockstream.info/api/tx/${txid}`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const tx = JSON.parse(data);
                if (!tx || !tx.vout) {
                    return callback(false, "Invalid or unconfirmed transaction.");
                }

                let isValidRecipient = false;
                let totalSatoshis = 0;

                tx.vout.forEach(output => {
                    if (output.scriptpubkey_address === OFFICIAL_BTC_WALLET) {
                        isValidRecipient = true;
                        totalSatoshis += output.value;
                    }
                });

                if (!isValidRecipient) {
                    return callback(false, "Payment address does not match official 04UX vault.");
                }

                if (totalSatoshis < 5000) {
                    return callback(false, "Insufficient payment amount detected.");
                }

                verifiedTransactions.add(txid);
                callback(true, "Payment verified successfully on blockchain.");
            } catch (e) {
                callback(false, "Error parsing blockchain verification data.");
            }
        });
    }).on('error', () => {
        callback(false, "Network error connecting to Bitcoin network.");
    });
}

// Validación de pago para usuarios estándar (Excluye al Jefe 0 con contraseña 197126)
app.post('/api/verify-payment', (req, res) => {
    const { txid, user, pass } = req.body;
    
    if (user === "0" && pass === "197126") {
        return res.json({ success: true, downloadUrl: "/download/04ux-secure-system-package.zip" });
    }

    if (!txid) return res.status(400).json({ success: false, message: "TXID required for standard users." });

    verifyBitcoinTransaction(txid, (success, message) => {
        if (success) {
            res.json({ success: true, downloadUrl: "/download/04ux-secure-system-package.zip" });
        } else {
            res.status(400).json({ success: false, message: message });
        }
    });
});

// Generar link gratis exclusivo para el Jefe Ux 0
app.post('/api/generate-boss-link', (req, res) => {
    const { user, pass } = req.body;
    if (user !== "0" || pass !== "197126") {
        return res.status(403).json({ success: false, message: "Unauthorized." });
    }
    const inviteToken = "VIP_" + Math.random().toString(36).substring(2, 10).toUpperCase();
    res.json({ success: true, inviteLink: `/download/04ux-secure-system-package.zip?token=${inviteToken}` });
});

app.get('/download/04ux-secure-system-package.zip', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename=04UX-Secure-System.zip');
    res.send("04UX PROTOCOL SECURE ENCRYPTED EXECUTABLE PACKAGE - FOUNDER: LENOX JG");
});

io.on('connection', (socket) => {
    socket.on('user_message', (data) => {
        io.emit('broadcast_message', data);
    });
    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`04UX.COM Protocol active on port ${PORT}`);
});
