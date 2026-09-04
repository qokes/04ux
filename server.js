const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('./'));

const OFFICIAL_BTC = 'bc1qep3ntxf6lz037ny04706u88jsl364p0ny4776s'; // TU BILLETERA OFICIAL
const MEMPOOL_API = 'https://mempool.space/api';

let usedTxids = new Set();
if(fs.existsSync('./used_txids.json')){
  usedTxids = new Set(JSON.parse(fs.readFileSync('./used_txids.json')));
}

let users = {}; // { uxNumber: { pin, vipUntil } }
let offlineBox = {}; // buzón offline

// API registro fácil + anti-multicuentas HWID
app.post('/api/register', (req,res)=>{
  const { uxNumber, pin, hwid } = req.body;
  if(users[uxNumber]) return res.status(400).json({error:'UX ya existe'});
  users[uxNumber] = { pin, hwid, vipUntil: 0 };
  res.json({ok:true});
});

// API verificar pago VIP $9.99 en BTC
app.post('/api/verify-vip', async (req,res)=>{
  const { txid } = req.body;
  if(usedTxids.has(txid)) return res.status(403).json({error:'TXID ya usado'});

  try{
    const { data: tx } = await axios.get(`${MEMPOOL_API}/tx/${txid}`);
    if(!tx.status.confirmed) return res.status(400).json({error:'No confirmado aún'});

    const valid = tx.vout.find(v => v.scriptpubkey_address === OFFICIAL_BTC);
    if(!valid) return res.status(400).json({error:'No llegó a billetera oficial'});

    usedTxids.add(txid);
    fs.writeFileSync('./used_txids.json', JSON.stringify([...usedTxids]));

    // Activa VIP 30 días por $9.99
    res.json({success:true, msg:'VIP $9.99 ACTIVADO'});
  }catch(e){
    res.status(400).json({error:'TXID inválido'});
  }
});

io.on('connection', socket=>{
  socket.on('ux-login', (ux)=>{
    socket.join(ux);
    if(offlineBox[ux]){
      socket.emit('offline-messages', offlineBox[ux]);
      delete offlineBox[ux];
    }
  });
  socket.on('ux-send', (data)=>{
    const { to, msg } = data;
    if(io.sockets.adapter.rooms.get(to)){
      io.to(to).emit('ux-message', { from: socket.ux, msg });
    }else{
      if(!offlineBox[to]) offlineBox[to] = [];
      offlineBox[to].push({from: socket.ux, msg});
    }
  });
});

server.listen(process.env.PORT || 3000, ()=>console.log('04UX.COM - FUNDADOR LENOX JG - Corriendo'));
