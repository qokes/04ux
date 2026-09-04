const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos si pones tu HTML en la misma carpeta
app.use(express.static(__dirname));

// TU BILLETERA REAL DE BITCOIN (Aquí deben llegar los pagos reales)
const REAL_WALLET_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

// Base de datos en memoria (puedes reemplazarla por MongoDB o SQL)
let usersDB = {};       // { "12345": { pass: "123", balance: 20, hwId: "..." } }
let usedTxids = new Set(); // Evita que reutilicen el mismo comprobante de pago

// 1. Registro de Nodo
app.post('/api/register-node', (req, res) => {
    const { user, pass, hwId } = req.body;
    if (!user || !pass) return res.json({ success: false, message: "Datos incompletos." });

    if (usersDB[user]) {
        return res.json({ success: false, message: "Este número UX ya está registrado." });
    }

    usersDB[user] = { pass, balance: 20, hwId: hwId || '' };
    res.json({ success: true, balance: 20, message: "Nodo registrado con 20 UX iniciales." });
});

// 2. Inicio de Sesión
app.post('/api/login-node', (req, res) => {
    const { user, pass } = req.body;
    if (!usersDB[user]) {
        // Si no existe, lo creamos automáticamente para agilizar
        usersDB[user] = { pass, balance: 20 };
    }
    
    if (usersDB[user].pass !== pass) {
        return res.json({ success: false, message: "PIN incorrecto." });
    }

    res.json({ success: true, balance: usersDB[user].balance });
});

// 3. VERIFICADOR REAL DE PAGOS BLOCKCHAIN (Anti-Fraude)
app.post('/api/verify-bitcoin-payment', async (req, res) => {
    const { user, txid, packageKey } = req.body;

    if (!user || !txid || !packageKey) {
        return.status(400).json({ success: false, message: "Faltan parámetros de pago." });
    }

    if (!usersDB[user]) {
        return.status(400).json({ success: false, message: "Usuario no válido." });
    }

    // Evitar doble gasto o reutilización del mismo TXID
    if (usedTxids.has(txid)) {
        return.status(400).json({ success: false, message: "⚠️ Este TXID ya fue utilizado anteriormente." });
    }

    try {
        // Consultar la API pública de Mempool para verificar la transacción en tiempo real
        const response = await axios.get(`https://mempool.space/api/tx/${txid}`);
        const txData = response.data;

        if (!txData || !txData.status) {
            return.status(400).json({ success: false, message: "La transacción no existe en la red Bitcoin." });
        }

        // Validar que el pago haya sido enviado estrictamente a TU billetera real
        let paymentFound = false;
        let totalSatoshisSent = 0;

        txData.vout.forEach(output => {
            if (output.scriptpubkey_address === REAL_WALLET_ADDRESS) {
                paymentFound = true;
                totalSatoshisSent += output.value; // Cantidad en Satoshis
            }
        });

        if (!paymentFound) {
            return.status(400).json({ success: false, message: "El pago no fue enviado a la billetera oficial de 04UX." });
        }

        // Mapeo de paquetes a UX acreditados
        const packageValues = {
            "250": 250,
            "500": 500,
            "1250": 1250,
            "2500": 2500,
            "10000": 10000,
            "100000": 100000
        };

        const uxToAdd = packageValues[packageKey] || 250;

        // Registrar TXID como usado
        usedTxids.add(txid);

        // Acreditar saldo real
        usersDB[user].balance += uxToAdd;

        res.json({
            success: true,
            message: `¡Pago confirmado en la Blockchain! +${uxToAdd} UX acreditados.`,
            newBalance: usersDB[user].balance
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Error al verificar el TXID en la red Bitcoin o transacción inválida." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor 04UX activo en puerto ${PORT}`);
});
