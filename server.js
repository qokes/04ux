const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('./'));
app.use(express.json());

const OFFICIAL_BTC = 'bc1qep3ntxf6lz037ny04706u88jsl364p0ny4776s';
let usedTxids = new Set();
if(fs.existsSync('./used_txids.json')){ try{ usedTxids = new Set(JSON.parse(fs.readFileSync('./used_txids.json')));}catch(e){} }

let users = { "0": { pin: "197126", role: "REY", verified: true, vipUntil: 9999999999999 } };
let onlineUsers = {};
let offlineBox = {};

app.post('/api/login', (req,res)=>{
  const { ux, pin } = req.body;
  if(!users[ux]) users[ux] = { pin, role: "USER", verified: false, vipUntil: 0 };
  if(users[ux].pin!== pin) return res.status(403).json({error:"PIN incorrecto"});
  const isVip = Date.now() < users[ux].vipUntil;
  return res.json({ ok:true, role: users[ux].role, verified: users[ux].verified, isVip });
});

app.post('/api/verify-btc', async (req,res)=>{
  const { txid, ux } = req.body;
  if(!txid) return res.status(400).json({error:"Falta TXID"});
  if(usedTxids.has(txid)) return res.status(403).json({error:"TXID ya usado - Anti fraude"});
  try{
    const { data: tx } = await axios.get(`https://mempool.space/api/tx/${txid}`, {timeout:10000});
    if(!tx.status.confirmed) return res.status(400).json({error:"Aún no confirmado, espera 1 confirmación"});
    let amountSat = 0, found=false;
    for(let vout of tx.vout){ if(vout.scriptpubkey_address===OFFICIAL_BTC){ found=true; amountSat+=vout.value; } }
    if(!found) return res.status(400).json({error:`Pago no llegó a tu billetera oficial ${OFFICIAL_BTC}`});
    const { data: prices } = await axios.get('https://mempool.space/api/v1/prices');
    const minSat = Math.floor((9.99 / prices.USD) * 1e8 * 0.95);
    if(amountSat < minSat) return res.status(400).json({error:`Monto bajo. Requiere ~${(minSat/1e8).toFixed(8)} BTC`});
    usedTxids.add(txid); fs.writeFileSync('./used_txids.json', JSON.stringify([...usedTxids]));
    if(users[ux]){ users[ux].vipUntil = Date.now()+30*24*60*60*1000; users[ux].verified=true; }
    return res.json({ success:true, amountBtc: amountSat/1e8 });
  }catch(e){ return res.status(400).json({error:"TXID inválido o no existe"}); }
});

io.on('connection', (socket)=>{
  socket.on('ux-login', (ux)=>{ socket.ux=ux; onlineUsers[ux]=socket.id; socket.join(ux); if(offlineBox[ux]){ socket.emit('offline-messages', offlineBox[ux]); delete offlineBox[ux]; } });
  socket.on('ux-send', (data)=>{
    const { to, msg, from } = data;
    const sender=users[from]; if(!sender) return;
    const isVip = Date.now() < sender.vipUntil;
    if(!isVip && from!=="0") return socket.emit('error-vip',"Necesitas VIP $9.99 BTC");
    const payload={ from, msg, time:Date.now(), verified:sender.verified, role:sender.role };
    if(onlineUsers[to]) io.to(onlineUsers[to]).emit('ux-message', payload);
    else { if(!offlineBox[to]) offlineBox[to]=[]; offlineBox[to].push(payload); }
  });
  socket.on('ux-logout-01s', ()=>{ if(socket.ux){ delete onlineUsers[socket.ux]; delete offlineBox[socket.ux]; } });
  socket.on('disconnect', ()=>{ if(socket.ux) setTimeout(()=>{ delete onlineUsers[socket.ux]; },100); });
});

server.listen(process.env.PORT || 3000, ()=>console.log('04UX.COM REY LENOX - BTC REAL - 0.1s - LISTO'));
