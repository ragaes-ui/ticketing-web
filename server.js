const path = require('path');
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const midtransClient = require('midtrans-client');

// --- MODEL DATABASE ---
const User = require('./models/users'); 
const Order = require('./models/order'); 
const Event = require('./models/event');
const Config = require('./models/config');

// --- MODEL: RIWAYAT LOGIN ---
const historySchema = new mongoose.Schema({
    userId: String,
    device: String,
    ip: String,
    timestamp: { type: Date, default: Date.now }
});
const LoginHistory = mongoose.model('LoginHistory', historySchema);

// --- MODEL BARU: RIWAYAT TOP UP SALDO ---
const topupSchema = new mongoose.Schema({
    userId: String,
    orderId: String,
    amount: Number,
    status: { type: String, default: 'pending' },
    timestamp: { type: Date, default: Date.now }
});
const Topup = mongoose.model('Topup', topupSchema);

// --- MODEL BARU: KODE PROMO ---
const promoSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true }, 
    discount: { type: Number, required: true }, 
    quota: { type: Number, default: 100 }, 
    expiresAt: { type: Date, required: true } 
});
const Promo = mongoose.model('Promo', promoSchema);

// --- MODEL BARU: RIWAYAT TRANSFER TIKET ---
const transferSchema = new mongoose.Schema({
    senderId: String,
    senderEmail: String,
    receiverEmail: String,
    ticketCode: String,
    eventName: String,
    timestamp: { type: Date, default: Date.now }
});
const TransferHistory = mongoose.model('TransferHistory', transferSchema);

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

// ==========================================
// 🛡️ KONFIGURASI KEYCLOAK SSO (SINGLE SIGN-ON)
// ==========================================
const session = require('express-session');
const Keycloak = require('keycloak-connect');

// 1. Buat penyimpanan sesi login
const memoryStore = new session.MemoryStore();
app.use(session({
    secret: 'rcellfest-rahasia-super-aman', 
    resave: false,
    saveUninitialized: true,
    store: memoryStore
}));

// 2. Data sambungan ke Cloud-IAM Kakak
const keycloakConfig = {
    "realm": "auth-rcellpublic", 
    "auth-server-url": "https://lemur-7.cloud-iam.com/auth/", 
    "ssl-required": "external",
    "resource": "rcellfest-app", 
    "credentials": {
        "secret": "91Q168SjaK78v6PPs0kcFLKnynhmyNb0" 
    },
    "confidential-port": 0
};

// 3. Nyalakan mesin Keycloak
const keycloak = new Keycloak({ store: memoryStore }, keycloakConfig);
app.use(keycloak.middleware());
// ==========================================

// ==========================================
// 🔒 RUTE TERKUNCI OLEH KEYCLOAK
// ==========================================
// Jika ada yang buka admin.html, harus lewat Keycloak dulu!
app.get('/admin.html', keycloak.protect(), (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'admin.html'));
});
// 👇 TAMBAHKAN RUTE LOGOUT DI SINI 👇
app.get('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(); // Menghapus memori login admin
    }
    res.redirect('/'); // Nendang admin balik ke halaman utama (index.html)
});
// 👇 FOLDER PUBLIC (Di bawah pelindung admin)
app.use(express.static(path.join(process.cwd(), 'public')));

// ==========================================
// 🛠️ KONEKSI DATABASE
// ==========================================
let cached = global.mongoose;
if (!cached) { cached = global.mongoose = { conn: null, promise: null }; }

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const opts = { bufferCommands: false, serverSelectionTimeoutMS: 5000 };
    const MONGO_URI = "mongodb+srv://konser_db:raga151204@cluster0.rutgg.mongodb.net/konser_db?retryWrites=true&w=majority";
    cached.promise = mongoose.connect(MONGO_URI, opts).then((mongoose) => {
      console.log('✅ DATABASE TERHUBUNG!');
      return mongoose;
    });
  }
  try { cached.conn = await cached.promise; } catch (e) { cached.promise = null; throw e; }
  return cached.conn;
}

app.use(async (req, res, next) => {
    if (req.path.includes('.') && !req.path.startsWith('/api')) return next();
    try { await connectDB(); next(); } 
    catch (error) { res.status(500).json({ error: "Database Connection Failed", detail: error.message }); }
});

// ==========================================
// KONFIGURASI MIDTRANS
// ==========================================
let snap = new midtransClient.Snap({
    isProduction : false, 
    serverKey : 'SB-Mid-server-bJeyNsEecyuBT4Lm6KC55-zg' 
});

// ==========================================
// --- ROUTES API ---
// ==========================================

// API KHUSUS CEK PING SERVER
app.get('/api/ping', (req, res) => {
    res.status(200).send('pong');
});

app.get('/api/events', async (req, res) => {
    try { 
        const events = await Event.find(); 
        const publicEvents = events.map(ev => {
            const eventObj = ev.toObject();
            if (eventObj.category === 'Streaming') {
                eventObj.description = "🔒 Detail akun (Email/Pass) akan muncul otomatis di menu Tiket Saya setelah pembayaran sukses.";
            }
            return eventObj;
        });
        res.json(publicEvents); 
    } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API BACA 1 EVENT DETAIL ---
app.get('/api/events/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "ID Event tidak valid" });
        }
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        const eventObj = event.toObject();
        if (eventObj.category === 'Streaming') {
            eventObj.description = "🔒 Detail akun (Email/Pass) akan muncul otomatis di menu Tiket Saya setelah pembayaran sukses.";
        }
        res.json(eventObj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/events', async (req, res) => {
    try {
        const { name, date, price, capacity, description, category, location, tickets } = req.body;
        const newEvent = new Event({
            name, date, price, totalCapacity: capacity, availableSeats: capacity,
            description: description || "", category: category || "General", location: location || "TBA",
            tickets: tickets || []
        });
        await newEvent.save();
        res.json(newEvent);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/events/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "ID Konser gak valid" });
        const updatedEvent = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true }); 
        res.json({ message: "Sukses update!", data: updatedEvent });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/events/:id', async (req, res) => {
    try { await Event.findByIdAndDelete(req.params.id); res.json({ message: "Terhapus!" }); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

// --- API AUTHENTICATION & HISTORY ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, fullName, phone } = req.body;
        const cekEmail = await User.findOne({ email });
        if(cekEmail) return res.status(400).json({ message: "Email sudah terdaftar!" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, role: role || 'user', fullName, phone, saldo: 0 });
        await newUser.save();
        res.json({ success: true, message: "Registrasi Berhasil!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password, recaptchaToken } = req.body;

        if (!recaptchaToken) {
             return res.status(400).json({ success: false, message: "Akses ditolak. Token reCAPTCHA kosong!" });
        }

        const GOOGLE_SECRET_KEY = "6LdjRpcsAAAAAHjifU---iWnguHtyRnUHRynO__3"; 
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${GOOGLE_SECRET_KEY}&response=${recaptchaToken}`;
        
        const googleRes = await fetch(verifyUrl, { method: 'POST' });
        const googleData = await googleRes.json();
        
        if (!googleData.success) {
             return res.status(400).json({ success: false, message: "Verifikasi gagal! Sistem mendeteksi aktivitas robot." });
        }
        
        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user) return res.status(400).json({ success: false, message: "Akun tidak ditemukan" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Password salah" });

        await LoginHistory.create({
            userId: user._id,
            device: req.headers['user-agent'] || "Unknown Device",
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        });

        res.json({ 
            success: true, 
            token: "token-rahasia-" + user._id, 
            user: { 
                id: user._id, username: user.username, email: user.email, 
                role: user.role, fullName: user.fullName, phone: user.phone, 
                saldo: user.saldo || 0, hasPin: !!user.pin 
            } 
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { username, pin, newPassword } = req.body;
        const user = await User.findOne({ username: new RegExp('^' + username + '$', 'i') });
        if (!user) return res.status(404).json({ success: false, message: "Username tidak ditemukan." });

        if (!user.pin) return res.status(400).json({ success: false, message: "Akun ini belum mengatur PIN. Silakan hubungi Admin untuk reset manual." });

        const isPinMatch = await bcrypt.compare(pin, user.pin);
        if (!isPinMatch) return res.status(400).json({ success: false, message: "PIN Keamanan salah! Akses ditolak." });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: "Password berhasil direset." });
    } catch (error) { res.status(500).json({ success: false, message: "Terjadi kesalahan pada server." }); }
});

app.post('/api/history', async (req, res) => {
    try {
        const { userId } = req.body;
        const logs = await LoginHistory.find({ userId }).sort({ timestamp: -1 }).limit(10);
        res.json(logs);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/my-tickets', async (req, res) => {
    try { const tickets = await Order.find({ email: req.body.email, status: { $in: ['valid', 'used'] } }).populate('eventId'); res.json(tickets); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tickets/transfer', async (req, res) => {
    try {
        const { ticket_code, receiver_email, userId, pin } = req.body;

        if (!userId || !pin) return res.status(400).json({ message: "Sistem menolak: PIN Keamanan tidak disertakan!" });
        const sender = await User.findById(userId);
        if (!sender || !sender.pin) return res.status(400).json({ message: "Akun kamu belum mengatur PIN. Silakan atur PIN di menu profile dulu!" });
        
        const isPinMatch = await bcrypt.compare(pin, sender.pin);
        if (!isPinMatch) return res.status(400).json({ message: "PIN Keamanan Salah! Transfer digagalkan." });

        const receiver = await User.findOne({ email: new RegExp('^' + receiver_email + '$', 'i') });
        if (!receiver) return res.status(404).json({ message: "Email penerima tidak terdaftar di sistem!" });

        const ticket = await Order.findOne({ ticketCode: ticket_code.toUpperCase() }).populate('eventId');
        if (!ticket) return res.status(404).json({ message: "Tiket tidak ditemukan." });
        if (ticket.status !== 'valid') return res.status(400).json({ message: "Gagal: Tiket sudah terpakai atau hangus." });
        if (ticket.email.toLowerCase() === receiver_email.toLowerCase()) return res.status(400).json({ message: "Nggak bisa transfer ke email sendiri dong!" });

        const emailPengirimAsli = ticket.email; 

        await Order.updateOne(
            { _id: ticket._id },
            { $set: { email: receiver.email, customerName: receiver.fullName || receiver.username } }
        );

        await TransferHistory.create({
            senderId: sender._id, 
            senderEmail: emailPengirimAsli, 
            receiverEmail: receiver.email,
            ticketCode: ticket.ticketCode,
            eventName: ticket.eventId ? ticket.eventId.name : "Tiket RCELLFEST"
        });

        res.json({ success: true, message: "Tiket berhasil dipindah tangan!", receiver: receiver.fullName || receiver.username });
    } catch (error) { res.status(500).json({ message: "Sistem Error: " + error.message }); }
});

app.post('/api/balance-history', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const topups = await Topup.find({ userId: userId, status: 'success' });
        const historyTopup = topups.map(t => ({
            type: 'in', 
            title: 'Top Up Saldo', 
            amount: t.amount, 
            date: t.timestamp || t._id.getTimestamp(), 
            id: t.orderId
        }));

        const orders = await Order.find({ 
            email: new RegExp('^' + user.email + '$', 'i'), 
            $or: [{ paymentMethod: { $regex: /saldo/i } }, { orderIdMidtrans: { $regex: /SALDO/i } }]
        }).populate('eventId');
        
        const historyOrder = orders.map(o => ({
            type: 'out', 
            title: `Beli: ${o.eventId ? o.eventId.name : 'Tiket Event'}`, 
            amount: o.price || 0, 
            date: o.createdAt || o._id.getTimestamp(), 
            id: o.ticketCode
        }));

        const transfers = await TransferHistory.find({ senderEmail: user.email });
        const historyTransfer = transfers.map(tr => ({
            type: 'transfer_out', 
            title: `Kirim Tiket: ${tr.eventName}`, 
            amount: 0,
            date: tr.timestamp || tr._id.getTimestamp(), 
            id: tr.ticketCode, 
            info: `Ke: ${tr.receiverEmail}`
        }));

        const fullHistory = [...historyTopup, ...historyOrder, ...historyTransfer].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        res.json(fullHistory);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/user/profile/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });
        res.json({ id: user._id, username: user.username, email: user.email, fullName: user.fullName, saldo: user.saldo || 0, hasPin: !!user.pin });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/topup', async (req, res) => {
    try {
        const { userId, email, name, amount } = req.body;
        const orderId = `TOPUP-${Date.now()}`;
        
        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: amount },
            customer_details: { first_name: name, email: email },
            item_details: [{ id: "TOPUP-SALDO", price: amount, quantity: 1, name: "Top Up Saldo RCELLFEST" }]
        };
        
        const transaction = await snap.createTransaction(parameter);
        await Topup.create({ userId, orderId, amount, status: 'pending' });
        res.json({ token: transaction.token, orderId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/user/set-pin', async (req, res) => {
    try {
        const { userId, oldPin, newPin, pin } = req.body;
        const finalPin = newPin || pin;

        if (!finalPin || finalPin.length !== 6) return res.status(400).json({ message: "PIN baru harus 6 angka bulat!" });
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

        if (user.pin) {
            if (!oldPin) return res.status(400).json({ message: "Harap masukkan PIN Lama." });
            const isMatch = await bcrypt.compare(oldPin, user.pin);
            if (!isMatch) return res.status(400).json({ message: "PIN Lama salah!" });
        }

        user.pin = await bcrypt.hash(finalPin, 10);
        await user.save();
        res.json({ success: true, message: "PIN berhasil disimpan!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 1. Bayar Pakai Saldo
app.post('/api/buy-ticket', async (req, res) => {
    try {
        const { recaptchaToken, userId, eventId, price, quantity = 1, pin, promoCode, buyerData, tierName } = req.body; 
        
        if (!recaptchaToken) return res.status(400).json({ success: false, message: "Akses ditolak. Token reCAPTCHA kosong!" });

        const GOOGLE_SECRET_KEY = "6LdjRpcsAAAAAHjifU---iWnguHtyRnUHRynO__3"; 
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${GOOGLE_SECRET_KEY}&response=${recaptchaToken}`;
        
        const googleRes = await fetch(verifyUrl, { method: 'POST' });
        const googleData = await googleRes.json();
        
        if (!googleData.success) return res.status(400).json({ success: false, message: "Verifikasi Robot gagal! Sistem menolak transaksi." });
        
        const userCheck = await User.findById(userId);
        if (!userCheck) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        if (!userCheck.pin) return res.status(400).json({ success: false, message: "Belum set PIN." });
        const isPinMatch = await bcrypt.compare(pin, userCheck.pin);
        if (!isPinMatch) return res.status(400).json({ success: false, message: "PIN Saldo salah!" });

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: "Event tidak ditemukan" });

        let selectedTierIndex = -1;
        if (tierName && event.tickets && event.tickets.length > 0) {
            selectedTierIndex = event.tickets.findIndex(t => t.tierName === tierName);
        }

        let discountAmount = 0;
        if (promoCode) {
            const promo = await Promo.findOne({ code: promoCode.toUpperCase() });
            if (promo && promo.quota > 0 && new Date() < promo.expiresAt) {
                discountAmount = promo.discount;
                promo.quota -= 1;
                await promo.save();
            }
        }

        let finalPrice = price - discountAmount;
        if (finalPrice < 0) finalPrice = 0;

        const user = await User.findOneAndUpdate(
            { _id: userId, saldo: { $gte: finalPrice } }, 
            { $inc: { saldo: -finalPrice } },
            { new: true }
        );
        if (!user) return res.status(400).json({ success: false, message: "Saldo tidak cukup!" });

        const randomStr = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
        const ticketCode = `TIKET-${randomStr.toUpperCase()}`; 
        
        const newOrder = new Order({
            ticketCode: ticketCode,
            eventId: eventId,
            price: finalPrice,
            tierName: tierName || 'General',
            quantity: quantity,
            customerName: buyerData ? buyerData.name : (user.fullName || user.username),
            email: buyerData ? buyerData.email : user.email,
            phone: buyerData ? buyerData.phone : user.phone,
            nik: buyerData ? buyerData.nik : undefined,
            status: 'valid',
            paymentMethod: 'SALDO', 
            orderIdMidtrans: `SALDO-PAY-${Date.now()}` 
        });
        await newOrder.save();
        
        event.availableSeats -= quantity; 
        if (selectedTierIndex !== -1) {
            event.tickets[selectedTierIndex].availableSeats -= quantity; 
        }
        await event.save();

        res.json({ success: true, message: "Pembelian berhasil!", ticketCode: ticketCode, sisaSaldo: user.saldo });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 2. Minta Token Midtrans (Jangan simpan Order dulu)
app.post('/api/payment-token', async (req, res) => {
    try {
        const { recaptchaToken, eventId, quantity = 1, price, customerName, customerEmail, customerPhone, tierName } = req.body; 
        
        if (!recaptchaToken) return res.status(400).json({ success: false, message: "Akses ditolak. Token reCAPTCHA kosong!" });

        const GOOGLE_SECRET_KEY = "6LdjRpcsAAAAAHjifU---iWnguHtyRnUHRynO__3"; 
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${GOOGLE_SECRET_KEY}&response=${recaptchaToken}`;
        
        const googleRes = await fetch(verifyUrl, { method: 'POST' });
        const googleData = await googleRes.json();
        
        if (!googleData.success) return res.status(400).json({ success: false, message: "Verifikasi Robot gagal! Sistem menolak transaksi." });
        
        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ message: 'Event tidak ditemukan' });

        const gross_amount = price * quantity;
        const orderId = `TICKET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: gross_amount },
            customer_details: { first_name: customerName, email: customerEmail, phone: customerPhone || "0800000000" },
            item_details: [{ id: eventId, price: price, quantity: quantity, name: `${event.name.substring(0, 30)} - ${tierName || 'General'}` }]
        };

        const token = await snap.createTransactionToken(parameter);
        res.json({ token, orderId });
    } catch (error) { res.status(500).json({ message: 'Gagal membuat token pembayaran' }); }
});

// 3. Simpan Tiket ke DB Jika Midtrans Berhasil (VALID)
app.post('/api/midtrans-success', async (req, res) => {
    try {
        const { eventId, customerName, customerEmail, tierName, price, quantity = 1, orderId, buyerData } = req.body;
        
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ success: false, message: "Event tidak ditemukan" });

        let selectedTierIndex = -1;
        if (tierName && event.tickets && event.tickets.length > 0) {
            selectedTierIndex = event.tickets.findIndex(t => t.tierName === tierName);
        }

        const randomStr = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
        const ticketCode = `TIKET-${randomStr.toUpperCase()}`; 
        
        const newOrder = new Order({
            ticketCode: ticketCode,
            eventId: eventId,
            price: price, 
            tierName: tierName || 'General',
            quantity: quantity,
            customerName: customerName,
            email: customerEmail,
            phone: buyerData ? buyerData.phone : undefined,
            nik: buyerData ? buyerData.nik : undefined,
            status: 'valid',
            paymentMethod: 'MIDTRANS', 
            orderIdMidtrans: orderId
        });
        await newOrder.save();

        event.availableSeats -= quantity; 
        if (selectedTierIndex !== -1) {
            event.tickets[selectedTierIndex].availableSeats -= quantity; 
        }
        await event.save();

        res.json({ success: true, ticketCode });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==========================================
// 🔔 WEBHOOK MIDTRANS 
// ==========================================
app.post('/api/payment-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;
        let fraudStatus = statusResponse.fraud_status;

        if (orderId.startsWith('TOPUP-')) {
            const topup = await Topup.findOne({ orderId: orderId });
            if (!topup) return res.status(404).json({ message: "Data Top Up tidak ditemukan" });

            if (transactionStatus == 'capture' || transactionStatus == 'settlement'){
                if (fraudStatus == 'accept' || !fraudStatus) {
                    if (topup.status !== 'success') {
                        topup.status = 'success'; await topup.save();
                        await User.findByIdAndUpdate(topup.userId, { $inc: { saldo: topup.amount } });
                    }
                }
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
                topup.status = 'failed'; await topup.save();
            }
        } 
        else {
            const order = await Order.findOne({ orderIdMidtrans: orderId });
            if (order) {
                if (transactionStatus == 'capture' || transactionStatus == 'settlement'){
                    if (fraudStatus == 'challenge') {
                        order.status = 'pending'; await order.save();
                    } else {
                        if(order.status !== 'valid') { order.status = 'valid'; await order.save(); }
                    }
                } 
                else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
                    await Order.findOneAndDelete({ orderIdMidtrans: orderId });
                } 
            }
        }
        res.status(200).send('OK');
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/validate', async (req, res) => {
    try {
        const { ticketCode } = req.body;
        if (!ticketCode) return res.status(400).json({ valid: false, message: "KODE KOSONG", detail: "Harap masukkan kode tiket." });

        const ticket = await Order.findOne({ ticketCode: ticketCode.toUpperCase() }).populate('eventId');

        if (!ticket) return res.json({ valid: false, message: "TIKET TIDAK DITEMUKAN", detail: "Kode tiket tidak terdaftar di sistem kami." });
        if (ticket.status === 'used') return res.json({ valid: false, message: "TIKET SUDAH DIPAKAI", detail: "Tiket ini sudah pernah di-scan sebelumnya. Akses ditolak!" });

        ticket.status = 'used';
        await ticket.save();

        res.json({ valid: true, data: { event: ticket.eventId ? ticket.eventId.name : "RCELLFEST Event", name: ticket.customerName } });
    } catch (error) { res.status(500).json({ valid: false, message: "Sistem Error", detail: "Gagal memproses data." }); }
});

app.post('/api/verify-ticket', async (req, res) => {
    try {
        const { ticketCode } = req.body;
        const ticket = await Order.findOne({ ticketCode: ticketCode.toUpperCase() }).populate('eventId');
        
        if (!ticket) return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan atau KODE PALSU!' });
        
        res.json({
            success: true,
            ticket: {
                code: ticket.ticketCode,
                customerName: ticket.customerName,
                eventName: ticket.eventId ? ticket.eventId.name : 'Event telah dihapus',
                tierName: ticket.tierName || 'General',
                quantity: ticket.quantity || 1,
                paymentMethod: ticket.paymentMethod,
                status: ticket.status,
                buyDate: ticket.createdAt
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' }); }
});

app.post('/api/use-ticket', async (req, res) => {
    try {
        const { ticketCode } = req.body;
        const ticket = await Order.findOne({ ticketCode: ticketCode.toUpperCase() });
        
        if (!ticket) return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan!' });
        if (ticket.status === 'used') return res.status(400).json({ success: false, message: 'Tiket ini SUDAH DIPAKAI sebelumnya!' });

        ticket.status = 'used'; 
        await ticket.save();
        res.json({ success: true, message: 'Berhasil Check-In! Tiket hangus.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Terjadi kesalahan.' }); }
});

app.put('/api/user/update-name', async (req, res) => {
    try {
        const user = await User.findById(req.body.userId);
        user.username = req.body.newName; if(user.fullName) user.fullName = req.body.newName;
        await user.save(); res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/user/change-password', async (req, res) => {
    try {
        const { userId, oldPassword, newPassword } = req.body;
        const user = await User.findById(userId);
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Password lama salah!" });
        user.password = await bcrypt.hash(newPassword, 10); await user.save();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/maintenance', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'maintenance' });
        if (!config) { config = new Config({ key: 'maintenance', isActive: false }); await config.save(); }
        res.json(config);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/maintenance', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'maintenance' });
        if (!config) config = new Config({ key: 'maintenance', isActive: req.body.isActive }); else config.isActive = req.body.isActive;
        await config.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/check-promo', async (req, res) => {
    try {
        const { code } = req.body;
        const promo = await Promo.findOne({ code: code.toUpperCase() });

        if (!promo) return res.json({ valid: false, message: "Kode promo tidak ditemukan." });
        if (promo.quota <= 0) return res.json({ valid: false, message: "Kuota promo habis." });
        if (new Date() > promo.expiresAt) return res.json({ valid: false, message: "Kode promo sudah kadaluarsa." });

        res.json({ valid: true, discount: promo.discount, message: `Diskon Rp ${promo.discount.toLocaleString('id-ID')}!` });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/promos', async (req, res) => {
    try { const promos = await Promo.find().sort({ _id: -1 }); res.json(promos); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/promos', async (req, res) => {
    try {
        const { code, discount, quota, daysActive } = req.body;
        const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + parseInt(daysActive));
        const newPromo = new Promo({ code, discount, quota, expiresAt });
        await newPromo.save();
        res.json({ success: true, message: "Promo berhasil dibuat!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/promos/:id', async (req, res) => {
    try { await Promo.findByIdAndDelete(req.params.id); res.json({ success: true, message: "Promo dihapus!" }); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.json({ reply: "Kunci AI belum ada di Vercel! 🔑" });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Kamu adalah RCELL-Bot, asisten website tiket RCELLFEST. Jawab dengan sangat ramah, gaul, singkat, dan gunakan emoji. Pertanyaan user: ${message}` }] }]
            })
        });

        const data = await response.json();
        if (data.candidates && data.candidates[0].content) {
            res.json({ reply: data.candidates[0].content.parts[0].text });
        } else {
            res.json({ reply: "Duh, masih ada yang nyangkut kak: " + (data.error ? data.error.message : "Respon kosong.") });
        }
    } catch (error) { res.json({ reply: "Sinyal putus kak! 📶" }); }
});

// ==========================================
// 🛡️ API LAPORAN (Dilindungi Keycloak)
// ==========================================
app.get('/api/admin/reports', keycloak.protect(), async (req, res) => {
    try {
        const totalUser = await User.countDocuments();
        const { start, end, limit } = req.query;
        const maxRows = parseInt(limit) || 10;

        const semuaOrders = await Order.find({ status: { $in: ['valid', 'used'] } }).sort({ _id: -1 }).populate('eventId');
        let orderTersaring = semuaOrders;
        
        if (start && end) {
            const startDate = new Date(start).getTime();
            const endDate = new Date(end);
            endDate.setHours(23, 59, 59, 999); 
            const endwaktu = endDate.getTime();
            orderTersaring = semuaOrders.filter(order => {
                const waktuAsli = order.createdAt ? new Date(order.createdAt).getTime() : order._id.getTimestamp().getTime();
                return waktuAsli >= startDate && waktuAsli <= endwaktu;
            });
        }

        let totalPendapatan = 0;
        let totalTiket = 0;
        orderTersaring.forEach(order => {
            totalPendapatan += (order.price || 0); 
            totalTiket += (order.quantity || 1);
        });

        const transaksiTerbaru = orderTersaring.slice(0, maxRows).map(order => {
            let namaEvent = "Event RCELLFEST";
            if (order.eventId && order.eventId.name) namaEvent = order.eventId.name;
            else if (order.eventName) namaEvent = order.eventName;

            let metodeAsli = 'MIDTRANS';
            if (order.paymentMethod) {
                metodeAsli = order.paymentMethod.toUpperCase();
            } else if (order.orderIdMidtrans && order.orderIdMidtrans.includes('SALDO')) {
                metodeAsli = 'SALDO';
            }

            return {
                date: order.createdAt || order.date || order._id.getTimestamp(),
                ticketCode: order.ticketCode || '-',
                customerName: order.customerName || '-',
                eventName: namaEvent,
                paymentMethod: metodeAsli, 
                price: order.price || 0
            };
        });

        const chartData = {};
        const hariIni = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(hariIni);
            d.setDate(d.getDate() - i);
            const tglString = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            chartData[tglString] = 0; 
        }

        semuaOrders.forEach(order => {
            const waktuAsli = order.createdAt || order.date || order._id.getTimestamp();
            const orderDate = new Date(waktuAsli);
            const tglString = orderDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            if (chartData[tglString] !== undefined) {
                chartData[tglString] += (order.price || 0);
            }
        });

        res.json({
            success: true,
            totalPendapatan, totalTiket, totalUser, transaksiTerbaru,
            chartLabels: Object.keys(chartData), 
            chartValues: Object.values(chartData) 
        });

    } catch (error) { res.status(500).json({ success: false, message: "Gagal mengambil data laporan backend." }); }
});

// ==========================================
// 🛡️ API DATA USERS (Dilindungi Keycloak)
// ==========================================
app.get('/api/admin/users', keycloak.protect(), async (req, res) => {
    try {
        const users = await User.find({}, '-password').sort({ _id: -1 });
        res.json({ success: true, data: users });
    } catch (error) { res.status(500).json({ success: false, message: "Gagal mengambil data user." }); }
});

// ROUTE HANDLER TERAKHIR
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 5000;
module.exports = app;
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
