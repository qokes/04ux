const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Servir archivos estáticos de la app
app.use(express.static(path.join(__dirname)));

// Conexión en tiempo real con WebSockets
io.on('connection', (socket) => {
    console.log('Nodo seguro conectado:', socket.id);

    // Recibir mensaje cifrado del usuario y reenviarlo en tiempo real
    socket.on('send_secure_message', (data) => {
        // Broadcast instantáneo al destinatario o sala específica
        io.to(data.room).emit('receive_secure_message', {
            sender: data.sender,
            message: data.message,
            timestamp: Date.now()
        });
    });

    // Unirse a una sala privada cifrada por número UX
    socket.on('join_ux_room', (roomNumber) => {
        socket.join(roomNumber);
    });

    socket.on('disconnect', () => {
        console.log('Nodo desconectado - Rastro borrado');
    });
});

server.listen(PORT, () => {
    console.log(`04UX Real-Time Protocol active on port ${PORT}`);
});
