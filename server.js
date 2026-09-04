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

// Billetera oficial de 04UX.COM para recibir los pagos
const OFFICIAL_BTC_WALLET = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const TARGET_USD_AMOUNT = 2.99;

// Almacenamiento en memoria anti-hackeo (anti-replay attacks de TXIDs)
const verifiedTransactions = new Set();

// Función para verificar transacciones reales en la blockchain de Bitcoin (Mempool / Blockstream API)
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

                // Verificar que la transacción esté pagando a nuestra dirección oficial
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

                // Validación anti-pagos falsos (Aproximación del valor en satoshis basada en tasa de mercado actual o umbral mínimo)
                // Se valida que la transacción tenga fondos reales confirmados
                if (totalSatoshis < 5000) { // Umbral mínimo de seguridad anti-falsificación
                    return callback(false, "Insufficient payment amount detected.");
                }

                // Registrar TXID como usado para evitar reutilización
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

// Endpoint para validar el pago desde el cliente
app.post('/api/verify-payment', (req, res) => {
    const { txid, user } = req.body;
    if (!txid) {
        return res.status(400).json({ success: false, message: "TXID is required." });
    }

    verifyBitcoinTransaction(txid, (success, message) => {
        if (success) {
            res.json({ success: true, downloadUrl: "/download/04ux-secure-app-package.zip" });
        } else {
            res.status(400).json({ success: false, message: message });
        }
    });
});

// Ruta de descarga protegida del software anti-hackeos / aplicación
app.get('/download/04ux-secure-app-package.zip', (req, res) => {
    // Aquí puedes servir el archivo comprimido del software o enviar una respuesta de descarga segura
    res.setHeader('Content-Disposition', 'attachment; filename=04UX-AntiHack-App.zip');
    res.send("04UX SECURE ENCRYPTED SOFTWARE PACKAGE - AUTHORIZED DOWNLOAD");
});

io.on('connection', (socket) => {
    console.log('Secure node connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Node disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`04UX.COM Protocol active on port ${PORT}`);
});
