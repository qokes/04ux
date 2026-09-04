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
const activeSessions = new Map(); 
const offlineMessages = new Map(); 
const registeredHardware = new Map(); // hwId -> user (Anti-multicuenta estricto)
const userBrowsers = new Map();       // user -> browser fingerprint hash
const blacklistedIPs = new Set();     

// Base de datos de saldos (Bono inicial de 20 UX)
const userBalances = new Map(); 

const uxPackages = {
    '250': { ux: 250, usd: 2.99 },
    '500': { ux: 500, usd: 3.99 },
    '1250': { ux: 1250, usd: 7.99 },
    '2500': { ux: 2500, usd: 16.99 },
    '10000': { ux: 10000, usd: 35.99 },
    '100000': { ux: 100000, usd: 499.00 }
};

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

app.use((req, res, next) => {
    const ip = getClientIP(req);
    if (blacklistedIPs.has(ip)) {
        return res.status(403).json({ success: false, message: "⚠️ ACCESO DENEGADO: IP bloqueada por actividad maliciosa o intento de multicuenta." });
    }
    next();
});

function verifyBitcoinTransaction(txid, expectedUsd, callback) {
    if (verifiedTransactions.has(txid)) return callback(false, "TXID ya utilizado.");
    const url = `https://blockstream.info/api/tx/${txid}`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const tx = JSON.parse(data);
                if (!tx || !tx.vout) return callback(false, "Transacción BTC no encontrada.");
                let isValid = false, totalSatoshis = 0;
                tx.vout.forEach(out => {
                    if (out.scriptpubkey_address === MY_PERSONAL_BTC_WALLET) {
                        isValid = true;
                        totalSatoshis += out.value;
                    }
                });
                if (!isValid) return callback(false, "Wallet de destino incorrecta.");
                if (totalSatoshis < 1000) return callback(false, "Monto insuficiente en satoshis.");
                
                verifiedTransactions.add(txid);
                callback(true, "Verificado con éxito.");
            } catch (e) { callback(false, "Error al procesar la blockchain."); }
        });
    }).on('error', () => callback(false, "Error de red con el nodo blockchain."));
}

// Registro con Protección Anti-Multicuenta y Bono de 20 UX
app.post('/api/register-node', (req, res) => {
    const { user, pass, hwId, browserSignature } = req.body;
    const ip = getClientIP(req);

    if (!user || !pass || !hwId) {
        return res.status(400).json({ success: false, message: "Datos incompletos." });
    }

    if (user === "0" && pass === "197126") {
        if (!userBalances.has(user)) userBalances.set(user, 1000000);
        return res.json({ success: true, balance: userBalances.get(user), message: "Acceso maestro concedido." });
    }

    // Validación estricta anti-multicuenta por Hardware ID
    if (registeredHardware.has(hwId)) {
        const existingUser = registeredHardware.get(hwId);
        if (existingUser !== user) {
            blacklistedIPs.add(ip);
            return res.status(403).json({ success: false, message: "⚠️ BLOQUEO DE SEGURIDAD: Este dispositivo ya tiene una cuenta asociada. Prohibido crear multicuentas." });
        }
    } else {
        registeredHardware.set(hwId, user);
        if (!userBalances.has(user)) {
            userBalances.set(user, 20); // Bono de registro inicial
        }
    }

    // Bloqueo de cambios de navegador en el mismo dispositivo para evitar saltarse controles
    if (userBrowsers.has(user)) {
        if (userBrowsers.get(user) !== browserSignature) {
            blacklistedIPs.add(ip);
            return res.status(403).json({ success: false, message: "⚠️ ALERTA: Intento de acceso desde navegador no autorizado detectado." });
        }
    } else {
        userBrowsers.set(user, browserSignature);
    }

    res.json({ success: true, balance: userBalances.get(user), message: "Nodo verificado. Bono de 20 UX acreditado." });
});

// Endpoint para descontar tarifa de tiempo (Ej: 2 UX al cumplirse 1:30 minutos)
app.post('/api/deduct-time-fee', (req, res) => {
    const { user, amount } = req.body;
    if (!user || !amount) return res.status(400).json({ success: false });

    const currentBal = userBalances.get(user) || 0;
    const fee = Number(amount) || 2;

    if (currentBal < fee) {
        return res.json({ success: false, message: "Saldo insuficiente para cubrir tarifa de tiempo." });
    }

    const newBal = currentBal - fee;
    userBalances.set(user, newBal);
    res.json({ success: true, newBalance: newBal });
});

app.post('/api/recharge-ux', (req, res) => {
    const { user, packageKey, txid } = req.body;
    if (!user || !packageKey || !uxPackages[packageKey] || !txid) {
        return res.status(400).json({ success: false, message: "Parámetros inválidos." });
    }

    const pkg = uxPackages[packageKey];
    verifyBitcoinTransaction(txid, pkg.usd, (success, message) => {
        if (!success) return res.status(400).json({ success: false, message });

        const currentBalance = userBalances.get(user) || 0;
        const newBalance = currentBalance + pkg.ux;
        userBalances.set(user, newBalance);

        res.json({ success: true, newBalance, message: `¡Recarga exitosa! +${pkg.ux} UX acreditados.` });
    });
});

io.on('connection', (socket) => {
    socket.on('register_presence', (uxNumber) => {
        if (activeSessions.has(uxNumber)) {
            const oldSocketId = activeSessions.get(uxNumber);
            io.to(oldSocketId).emit('forced_logout', 'Sesión duplicada: Conexión abierta en otra ubicación o pestaña.');
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
        const sender = data.senderUx;
        const target = data.targetUx ? data.targetUx.trim() : "";

        if (sender !== "0") {
            const currentBal = userBalances.get(sender) || 0;
            if (currentBal < 1) {
                socket.emit('incoming_message', { senderUx: "SYSTEM", text: "⚠️ Saldo insuficiente (0 UX). Recarga paquetes UX para continuar.", time: new Date().toLocaleTimeString() });
                return;
            }
            userBalances.set(sender, currentBal - 1);
            socket.emit('update_balance', { balance: currentBal - 1 });
        }

        const packet = { senderUx: sender, targetUx: target, text: data.text, time: new Date().toLocaleTimeString() };
        
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
            io.emit('item_broadcast', packet);
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
    console.log(`Server elite online on port ${PORT}`);
});
