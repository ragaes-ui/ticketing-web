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

const app = express();

app.use(cors());
app.use(express.json());
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

// 🔒 API PUBLIC: SENSOR DESKRIPSI STREAMING
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

app.post('/api/events', async (req, res) => {
    try {
        const { name, date, price, capacity, description, category, location } = req.body;
        const newEvent = new Event({
            name, date, price, totalCapacity: capacity, availableSeats: capacity,
            description: description || "", category: category || "General", location: location || "TBA"
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
        // Pastikan model User kamu sudah ada field 'saldo', default 0 di registrasi ini aman
        const newUser = new User({ username, email, password: hashedPassword, role: role || 'user', fullName, phone, saldo: 0 });
        await newUser.save();
        res.json({ success: true, message: "Registrasi Berhasil!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user) return res.status(400).json({ success: false, message: "Akun tidak ditemukan" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Password salah" });

        await LoginHistory.create({
            userId: user._id,
            device: req.headers['user-agent'] || "Unknown Device",
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        });

        // UPDATE: Beritahu frontend apakah user sudah mengatur PIN atau belum (hasPin)
        res.json({ 
            success: true, 
            token: "token-rahasia-" + user._id, 
            user: { 
                id: user._id, 
                username: user.username, 
                email: user.email, 
                role: user.role, 
                fullName: user.fullName, 
                phone: user.phone, 
                saldo: user.saldo || 0,
                hasPin: !!user.pin // Convert keberadaan pin jadi boolean (true/false)
            } 
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

// ==========================================
// --- API SALDO BARU (TOP UP, BELI & PIN) ---
// ==========================================

// 1. Ambil Profil & Saldo Terbaru
app.get('/api/user/profile/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });
        
        // UPDATE: Sertakan juga status hasPin saat refresh profil
        res.json({ 
            id: user._id, 
            username: user.username, 
            email: user.email, 
            fullName: user.fullName, 
            saldo: user.saldo || 0,
            hasPin: !!user.pin 
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 2. Request Top Up (Generate Token Midtrans)
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
        
        // Catat di database dengan status pending
        await Topup.create({ userId, orderId, amount, status: 'pending' });

        res.json({ token: transaction.token, orderId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. API ATUR PIN SALDO
app.post('/api/user/set-pin', async (req, res) => {
    try {
        const { userId, pin } = req.body;
        // Validasi pin
        if (!pin || pin.length !== 6) return res.status(400).json({ message: "PIN harus 6 angka bulat!" });
        
        // Enkripsi pin
        const hashedPin = await bcrypt.hash(pin, 10);
        await User.findByIdAndUpdate(userId, { pin: hashedPin });
        
        res.json({ success: true, message: "PIN berhasil disetel!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});


// 4. Beli Tiket Menggunakan Saldo Langsung (WAJIBKAN PIN)
app.post('/api/buy-ticket', async (req, res) => {
    try {
        const { userId, eventId, price, quantity = 1, pin } = req.body; // <-- Terima PIN dari frontend
        
        // --- A. VALIDASI USER & PIN ---
        const userCheck = await User.findById(userId);
        if (!userCheck) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        
        // Cek apakah user ini sudah mengatur PIN di akunnya
        if (!userCheck.pin) {
            return res.status(400).json({ success: false, message: "Belum set PIN. Silakan atur PIN Keamanan di menu Dashboard/Profil." });
        }
        
        // Cek apakah input PIN dari form cocok dengan PIN di database
        const isPinMatch = await bcrypt.compare(pin, userCheck.pin);
        if (!isPinMatch) {
            return res.status(400).json({ success: false, message: "PIN Saldo yang kamu masukkan salah!" });
        }

        // --- B. PROSES PEMBELIAN TIKET ---
        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: "Event tidak ditemukan" });

        const totalHarga = price * quantity;

        // Potong saldo dengan mengecek kecukupan saldo (mencegah bug double request)
        const user = await User.findOneAndUpdate(
            { _id: userId, saldo: { $gte: totalHarga } }, 
            { $inc: { saldo: -totalHarga } },
            { new: true }
        );

        if (!user) return res.status(400).json({ success: false, message: "Saldo kamu tidak mencukupi. Silakan Top Up Saldo!" });

        // Generate tiket
        const randomStr = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
        const ticketCode = `TIKET-${randomStr.toUpperCase()}`; 
        
        const newOrder = new Order({
            ticketCode: ticketCode,
            eventId: eventId,
            customerName: user.fullName || user.username,
            email: user.email,
            status: 'valid', // Status langsung valid karena pakai saldo internal
            orderIdMidtrans: `SALDO-PAY-${Date.now()}` 
        });
        await newOrder.save();
        
        // Kurangi ketersediaan kursi
        event.availableSeats -= quantity;
        await event.save();
        
        // Kirim response sukses beserta sisa saldo terbaru
        res.json({ success: true, message: "Pembelian berhasil!", ticketCode: ticketCode, sisaSaldo: user.saldo });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});


// ==========================================
// --- PAYMENT & ORDER LAMA (VIA MIDTRANS) ---
// ==========================================

app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const order = await Order.findOne({ orderIdMidtrans: req.params.orderId }).populate('eventId');
        if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

        let responseData = { status: order.status, productName: order.eventId?.name, customerName: order.customerName, credentials: null };
        if (order.status === 'valid' || order.status === 'used') responseData.credentials = order.eventId?.description;
        res.json(responseData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/payment-token', async (req, res) => {
    try {
        const { eventId, customerName, customerEmail, quantity } = req.body;
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        const grossAmount = event.price * quantity;
        const orderId = "ORDER-" + new Date().getTime(); 

        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: grossAmount },
            credit_card:{ secure : true },
            customer_details: { first_name: customerName, email: customerEmail },
            item_details: [{ id: eventId, price: event.price, quantity: quantity, name: event.name.substring(0, 50) }]
        };

        const transaction = await snap.createTransaction(parameter);

        const randomStr = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
        const ticketCode = `TIKET-${randomStr.toUpperCase()}`; 
        
        const newOrder = new Order({
            ticketCode: ticketCode, eventId: eventId, customerName: customerName, email: customerEmail, status: 'pending', orderIdMidtrans: orderId 
        });
        await newOrder.save();
        res.json({ token: transaction.token, orderId: orderId });
    } catch (error) { console.log("Midtrans Error:", error); res.status(500).json({ message: error.message }); }
});

app.post('/api/cancel-order', async (req, res) => {
    try {
        const { orderId } = req.body;
        await Order.findOneAndDelete({ orderIdMidtrans: orderId, status: 'pending' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

        // 1. CEK APAKAH INI TRANSAKSI TOP UP SALDO
        if (orderId.startsWith('TOPUP-')) {
            const topup = await Topup.findOne({ orderId: orderId });
            if (!topup) return res.status(404).json({ message: "Data Top Up tidak ditemukan" });

            if (transactionStatus == 'capture' || transactionStatus == 'settlement'){
                if (fraudStatus == 'accept' || !fraudStatus) {
                    // Cek biar nggak nambah saldo 2x
                    if (topup.status !== 'success') {
                        topup.status = 'success';
                        await topup.save();
                        // Tambahkan saldo user
                        await User.findByIdAndUpdate(topup.userId, { $inc: { saldo: topup.amount } });
                    }
                }
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
                topup.status = 'failed';
                await topup.save();
            }
        } 
        // 2. CEK APAKAH INI PEMBELIAN TIKET LANGSUNG VIA MIDTRANS (NON-SALDO)
        else {
            const order = await Order.findOne({ orderIdMidtrans: orderId });
            if (!order) return res.status(404).json({message: "Order not found"});

            if (transactionStatus == 'capture' || transactionStatus == 'settlement'){
                if (fraudStatus == 'challenge') {
                    order.status = 'pending';
                    await order.save();
                } else {
                    if(order.status !== 'valid') {
                        order.status = 'valid';
                        const event = await Event.findById(order.eventId);
                        if(event) { event.availableSeats -= 1; await event.save(); }
                        await order.save();
                    }
                }
            } 
            else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
                await Order.findOneAndDelete({ orderIdMidtrans: orderId });
            } 
            else if (transactionStatus == 'pending'){
                order.status = 'pending';
                await order.save();
            }
        }

        res.status(200).send('OK');
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- API LAINNYA ---

app.post('/api/validate', async (req, res) => {
    try {
        const ticket = await Order.findOne({ ticketCode: req.body.ticketCode.trim() }).populate('eventId');
        if (!ticket) return res.status(404).json({ valid: false, message: "TIKET TIDAK DITEMUKAN!" });
        if (ticket.status === 'pending') return res.status(400).json({ valid: false, message: "BELUM DIBAYAR!" });
        if (ticket.status === 'used') return res.status(400).json({ valid: false, message: "SUDAH DIPAKAI!" });

        ticket.status = 'used'; 
        await ticket.save();
        res.json({ valid: true, message: "TIKET VALID! ✅", data: { name: ticket.customerName, event: ticket.eventId?.name } });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

// ROUTE HANDLER TERAKHIR
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// 404 Handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 5000;
module.exports = app;
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
