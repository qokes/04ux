const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('./'));
app.use(express.json());
app.set('trust proxy', 1);

const OFFICIAL_BTC = 'bc1qep3ntxf6lz037ny04706u88jsl364p0ny4776s';
const PRICE_USD = 3.99;

const limiter = rateLimit({ windowMs: 60*1000, max: 20, message: {error:"Too many requests - Antispam"} });
app.use('/api/', limiter);

let ipRegistry = {};
let usedTxids = new Set();
if(fs.existsSync('./used_txids.json')){ try{ usedTxids = new Set(JSON.parse(fs.readFileSync('./used_txids.json')));}catch(e){} }
if(fs.existsSync('./ip_registry.json')){ try{ ipRegistry = JSON.parse(fs.readFileSync('./ip_registry.json'));}catch(e){} }

let users = { "0": { pin: "197126", role: "REY", verified: true, vipUntil: 9999999999999, saldoUX: 99999, ip:"OWNER" } };
let onlineUsers = {};
let offlineBox = {};
let lastMsgTime = {};

function getVipStatus(user){
  if(!user) return { isVip:false, daysLeft:0 };
  const isVip = Date.now() < user.vipUntil;
  const daysLeft = isVip? Math.ceil((user.vipUntil - Date.now())/(24*60*60*1000)) : 0;
  return { isVip, daysLeft };
}
function checkIpBlock(ip){
  if(!ipRegistry[ip]) ipRegistry[ip] = { count:0, first:Date.now() };
  if(ipRegistry[ip].count >= 3) return true;
  return false;
}

app.post('/api/register', (req,res)=>{
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const { ux, pin, acceptedTerms } = req.body;
  if(!ux||!pin) return res.status(400).json({error:"Missing UX and PIN"});
  if(!acceptedTerms) return res.status(403).json({error:"You must accept Terms: NO harm NO illegal"});
  if(users[ux]) return res.status(400).json({error:"UX already exists, go to LOGIN"});
  if(checkIpBlock(ip)) return res.status(403).json({error:"IP/WIFI BLOCK: Max 3 accounts per WiFi/IP - Antispam active"});
  users[ux] = { pin, role:"USER", verified:false, vipUntil:0, saldoUX:20, createdAt:Date.now(), ip };
  ipRegistry[ip].count += 1;
  fs.writeFileSync('./ip_registry.json', JSON.stringify(ipRegistry));
  return res.json({ ok:true, saldoUX:20 });
});

app.post('/api/login', (req,res)=>{
  const { ux, pin } = req.body;
  if(!users[ux]) return res.status(404).json({error:"UX not found, please register"});
  if(users[ux].pin!==pin) return res.status(403).json({error:"Wrong PIN"});
  const { isVip, daysLeft } = getVipStatus(users[ux]);
  return res.json({ ok:true, role:users[ux].role, verified:users[ux].verified, isVip, daysLeft, saldoUX:users[ux].saldoUX });
});

app.post('/api/verify-btc', async (req,res)=>{
  const { txid, ux, plan } = req.body;
  if(!txid) return res.status(400).json({error:"Missing TXID"});
  if(usedTxids.has(txid)) return res.status(403).json({error:"TXID already used"});
  try{
    const { data: tx } = await axios.get(`https://mempool.space/api/tx/${txid}`, {timeout:10000});
    if(!tx.status.confirmed) return res.status(400).json({error:"Not confirmed yet, wait 1 block"});
    let amountSat=0,found=false;
    for(let vout of tx.vout){ if(vout.scriptpubkey_address===OFFICIAL_BTC){ found=true; amountSat+=vout.value; } }
    if(!found) return res.status(400).json({error:"Payment not arrived to official wallet"});
    const { data: prices } = await axios.get('https://mempool.space/api/v1/prices');
    const minSat = Math.floor((PRICE_USD / prices.USD) * 1e8 * 0.95);
    if(amountSat < minSat) return res.status(400).json({error:`Low amount, requires ~${(minSat/1e8).toFixed(8)} BTC ($3.99)`});
    usedTxids.add(txid); fs.writeFileSync('./used_txids.json', JSON.stringify([...usedTxids]));
    if(users[ux]){
      if(plan==='2months') users[ux].vipUntil = Date.now() + 60*24*60*60*1000;
      else users[ux].vipUntil = Date.now() + 90*24*60*60*1000;
      users[ux].verified=true; users[ux].saldoUX+=100;
    }
    return res.json({ success:true, amountBtc: amountSat/1e8, plan });
  }catch(e){ return res.status(400).json({error:"Invalid TXID"}); }
});

app.post('/api/discount-ux', (req,res)=>{
  const { ux } = req.body;
  if(!users[ux]) return res.json({ok:false});
  const { isVip } = getVipStatus(users[ux]);
  if(isVip || users[ux].role==="REY") return res.json({ ok:true, saldoUX: users[ux].saldoUX, isVip:true });
  if(users[ux].saldoUX>0) users[ux].saldoUX-=1;
  return res.json({ ok:true, saldoUX: users[ux].saldoUX });
});

io.on('connection', (socket)=>{
  socket.on('ux-login', (ux)=>{ socket.ux=ux; onlineUsers[ux]=socket.id; socket.join(ux); if(offlineBox[ux]){ socket.emit('offline-messages', offlineBox[ux]); delete offlineBox[ux]; } });
  socket.on('ux-send', (data)=>{
    const { to, msg, from, timer } = data;
    const now=Date.now();
    if(lastMsgTime[from] && now-lastMsgTime[from]<500) return socket.emit('error-vip',"Antispam: wait 0.5s");
    lastMsgTime[from]=now;
    const sender=users[from]; if(!sender) return;
    const { isVip } = getVipStatus(sender);
    if(!isVip){ if(sender.saldoUX<=0) return socket.emit('error-vip',"Balance 0 - VIP $3.99 USD 3 months"); sender.saldoUX-=1; }
    const payload={ from, msg, time:now, verified:sender.verified, role:sender.role, saldoUX:sender.saldoUX, timer:timer||0 };
    if(onlineUsers[to]) io.to(onlineUsers[to]).emit('ux-message', payload);
    else { if(!offlineBox[to]) offlineBox[to]=[]; offlineBox[to].push(payload); }
    socket.emit('saldo-update', sender.saldoUX);
  });
  socket.on('ux-logout-01s', ()=>{ if(socket.ux){ const u=users[socket.ux]; if(u){ const { isVip } = getVipStatus(u); if(!isVip && u.role!=="REY" && u.saldoUX>0) u.saldoUX-=1; } delete onlineUsers[socket.ux]; delete offlineBox[socket.ux]; } });
  socket.on('disconnect', ()=>{ if(socket.ux) setTimeout(()=>{ delete onlineUsers[socket.ux]; },100); });
});

server.listen(process.env.PORT || 3000, ()=>console.log(`04UX ENGLISH CYBER V6 - IP BLOCK - READY`));
