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

const MY_PERSONAL_BTC_WALLET = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"; 
const verifiedTransactions = new Set();
const activeSessions = new Map(); // uxNumber -> socketId
const offlineMessages = new Map(); // targetUx -> Array of messages

// ==========================================
// 🛡️ BLOQUEO DE SEGURIDAD EXTREMA (IP / HW)
// ==========================================
const registeredHardware = new Map(); // hwId -> uxNumber (1 Dispositivo = 1 Cuenta estricta)
const blacklistedIPs = new Set();     // IPs bloqueadas por fraude / cuentas múltiples

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

// Middleware global de seguridad por IP
app.use((req, res, next) => {
    const ip = getClientIP(req);
    if (blacklistedIPs.has(ip)) {
        return res.status(403).json({ success: false, message: "⚠️ ACCESO DENEGADO: Tu IP y red están bloqueadas permanentemente por intento de múltiples registros." });
    }
    next();
});

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

// API de Validación de Registro con Seguridad Extrema 1:1
app.post('/api/register-node', (req, res) => {
    const { user, pass, hwId } = req.body;
    const ip = getClientIP(req);

    if (!user || !pass || !hwId) {
        return res.status(400).json({ success: false, message: "Datos incompletos." });
    }

    // Cuenta Maestra bypass
    if (user === "0" && pass === "197126") {
        return res.json({ success: true, message: "Acceso maestro concedido." });
    }

    // Verificar si el hardware ya registró otra cuenta (Ej: cuentas 8, 9 intentando en el mismo cel)
    if (registeredHardware.has(hwId)) {
        const existingUser = registeredHardware.get(hwId);
        if (existingUser !== user) {
            blacklistedIPs.add(ip); // Bloquear IP y Red Wi-Fi
            return res.status(403).json({ 
                success: false, 
                message: `❌ VIOLACIÓN DE SEGURIDAD EXTREMA: Este dispositivo ya registró la cuenta UX ${existingUser}. Bloqueo permanente de IP y hardware aplicado.` 
            });
        }
    } else {
        // Registrar hardware vinculado a este número
        registeredHardware.set(hwId, user);
    }

    res.json({ success: true, message: "Nodo verificado y registrado con éxito." });
});

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

app.get('/download/04ux-system-package.zip', (req, res) => {
    const zipData = Buffer.from("PK\x03\x04\x14\x00\x00\x00\x08\x00" + "04UX_SYSTEM_CORE_BINARY_DATA".repeat(80));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=04UX-System.zip');
    res.send(zipData);
});

io.on('connection', (socket) => {
    socket.on('register_presence', (uxNumber) => {
        if (activeSessions.has(uxNumber)) {
            const oldSocketId = activeSessions.get(uxNumber);
            io.to(oldSocketId).emit('forced_logout', 'Session opened on another device.');
        }
        
        activeSessions.set(uxNumber, socket.id);
        socket.uxNumber = uxNumber;
        socket.join(`ux_${uxNumber}`);
        
        io.emit('update_status', { ux: uxNumber, online: true });

        if (offlineMessages.has(uxNumber)) {
            const pending = offlineMessages.get(uxNumber);
            pending.forEach(msg => { socket.emit('incoming_message', msg); });
            offlineMessages.delete(uxNumber);
        }
    });

    socket.on('private_chat', (data) => {
        const packet = { 
            senderUx: data.senderUx, 
            targetUx: data.targetUx, 
            text: data.text, 
            time: new Date().toLocaleTimeString() 
        };
        
        const target = data.targetUx ? data.targetUx.trim() : "";
        if (target !== "") {
            const targetSocketId = activeSessions.get(target);
            socket.emit('incoming_message', packet);
            
            if (targetSocketId) {
                io.to(targetSocketId).emit('incoming_message', packet);
            } else {
                if (!offlineMessages.has(target)) offlineMessages.set(target, []);
                offlineMessages.get(target).push(packet);
            }
        } else {
            io.emit('incoming_message', packet);
        }
    });

    socket.on('disconnect', () => {
        if (socket.uxNumber) {
            activeSessions.delete(socket.uxNumber);
            io.emit('update_status', { ux: socket.uxNumber, online: false });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server online on port ${PORT}`);
});
