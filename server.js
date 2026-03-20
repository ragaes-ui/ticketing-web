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
    code: { type: String, required: true, unique: true, uppercase: true }, // Kode Unik (misal: MERDEKA)
    discount: { type: Number, required: true }, // Jumlah Diskon (Rp)
    quota: { type: Number, default: 100 }, // Sisa Kuota
    expiresAt: { type: Date, required: true } // Tanggal Kadaluarsa
});
const Promo = mongoose.model('Promo', promoSchema);

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

// --- API RIWAYAT MUTASI SALDO (GABUNGAN TOPUP & BELI) ---
// Gantikan api/my-topups dengan ini:
app.post('/api/balance-history', async (req, res) => {
    try {
        const { userId } = req.body;
        
        // 1. Ambil Data User untuk dapatkan Email (karena Order disimpan pakai email)
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        // 2. Ambil Data Top Up (Uang Masuk) - Hanya yang sukses
        const topups = await Topup.find({ userId: userId, status: 'success' }).lean();
        const historyTopup = topups.map(t => ({
            type: 'in', // Masuk
            title: 'Top Up Saldo',
            amount: t.amount,
            date: t.timestamp,
            id: t.orderId
        }));

        // 3. Ambil Data Pembelian Tiket (Uang Keluar)
        // Kita filter yang orderIdMidtrans-nya diawali "SALDO-PAY" (artinya bayar pakai saldo)
        const orders = await Order.find({ 
            email: user.email, 
            orderIdMidtrans: { $regex: /^SALDO-PAY/ } 
        }).populate('eventId').lean();

        const historyOrder = orders.map(o => ({
            type: 'out', // Keluar
            title: `Beli: ${o.eventId?.name || 'Tiket Event'}`,
            amount: o.eventId?.price || 0, // Ambil harga dari event
            date: o.purchaseDate,
            id: o.ticketCode
        }));

        // 4. Gabungkan dan Urutkan dari yang paling baru
        const fullHistory = [...historyTopup, ...historyOrder].sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(fullHistory);

    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
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

// 3. API ATUR / UBAH PIN SALDO (DENGAN CEK PIN LAMA)
app.post('/api/user/set-pin', async (req, res) => {
    try {
        const { userId, oldPin, newPin, pin } = req.body;
        // Frontend mungkin mengirim 'newPin' (saat ubah) atau 'pin' (saat buat baru), kita ambil salah satu
        const finalPin = newPin || pin;

        // 1. Validasi Input Dasar
        if (!finalPin || finalPin.length !== 6) {
            return res.status(400).json({ message: "PIN baru harus 6 angka bulat!" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

        // 2. Jika User SUDAH punya PIN, wajib validasi PIN Lama
        if (user.pin) {
            if (!oldPin) {
                return res.status(400).json({ message: "Harap masukkan PIN Lama untuk keamanan." });
            }
            const isMatch = await bcrypt.compare(oldPin, user.pin);
            if (!isMatch) {
                return res.status(400).json({ message: "PIN Lama salah!" });
            }
        }

        // 3. Enkripsi PIN Baru dan Simpan
        const hashedPin = await bcrypt.hash(finalPin, 10);
        user.pin = hashedPin;
        await user.save();
        
        res.json({ success: true, message: "PIN berhasil disimpan!" });

    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});


// 4. Beli Tiket Menggunakan Saldo (DENGAN CHECKOUT DATA)
app.post('/api/buy-ticket', async (req, res) => {
    try {
        // 👇 TAMBAHKAN buyerData DI SINI
        const { userId, eventId, price, quantity = 1, pin, promoCode, buyerData } = req.body; 
        
        // --- A. VALIDASI USER & PIN ---
        const userCheck = await User.findById(userId);
        if (!userCheck) return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        
        if (!userCheck.pin) {
            return res.status(400).json({ success: false, message: "Belum set PIN. Silakan atur PIN di Dashboard." });
        }
        
        const isPinMatch = await bcrypt.compare(pin, userCheck.pin);
        if (!isPinMatch) {
            return res.status(400).json({ success: false, message: "PIN Saldo salah!" });
        }

        // --- B. CEK EVENT ---
        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: "Event tidak ditemukan" });

        // --- C. HITUNG HARGA & CEK PROMO ---
        let totalHarga = price * quantity;
        let discountAmount = 0;

        if (promoCode) {
            const promo = await Promo.findOne({ code: promoCode.toUpperCase() });
            if (promo && promo.quota > 0 && new Date() < promo.expiresAt) {
                discountAmount = promo.discount;
                promo.quota -= 1;
                await promo.save();
            }
        }

        let finalPrice = totalHarga - discountAmount;
        if (finalPrice < 0) finalPrice = 0;

        // --- D. POTONG SALDO ---
        const user = await User.findOneAndUpdate(
            { _id: userId, saldo: { $gte: finalPrice } }, 
            { $inc: { saldo: -finalPrice } },
            { new: true }
        );

        if (!user) return res.status(400).json({ success: false, message: "Saldo tidak cukup!" });

        // --- E. GENERATE TIKET & SIMPAN DATA PEMBELI ---
        const randomStr = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
        const ticketCode = `TIKET-${randomStr.toUpperCase()}`; 
        
        const newOrder = new Order({
            ticketCode: ticketCode,
            eventId: eventId,
            // 👇 TAMBAHKAN INI (Simpan harga yang dibayar setelah potong promo)
            price: finalPrice,
            tierName: req.body.tierName,
            // 👇 MASUKKAN DATA DARI FORM CHECKOUT KE DATABASE
            customerName: buyerData ? buyerData.name : (user.fullName || user.username),
            email: buyerData ? buyerData.email : user.email,
            phone: buyerData ? buyerData.phone : user.phone,
            nik: buyerData ? buyerData.nik : undefined,
            status: 'valid',
            paymentMethod: 'saldo', // Penanda bayar pakai saldo
            orderIdMidtrans: `SALDO-PAY-${Date.now()}` 
        });
        await newOrder.save();
        
                // Kurangi Kursi Event & Kursi Tier
        event.availableSeats -= quantity; // <-- Pastikan ini memotong 'quantity'
        if (selectedTierIndex !== -1) {
            event.tickets[selectedTierIndex].availableSeats -= quantity; // <-- Pastikan ini memotong 'quantity'
        }
        await event.save();



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

// 1. Request Token Pembayaran Midtrans (Hanya buat token, JANGAN simpan tiket dulu)
app.post('/api/payment-token', async (req, res) => {
    try {
        const { eventId, quantity = 1, customerName, customerEmail, customerPhone, tierName } = req.body;
        
        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ message: 'Event tidak ditemukan' });

        let hargaSatuan = event.price; 
        if (tierName && event.tickets && event.tickets.length > 0) {
            const selectedTier = event.tickets.find(t => t.tierName === tierName);
            if (selectedTier) hargaSatuan = selectedTier.price;
        }

        const gross_amount = hargaSatuan * quantity;
        const orderId = `TICKET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: gross_amount },
            customer_details: { first_name: customerName, email: customerEmail, phone: customerPhone || "0800000000" },
            item_details: [{ id: eventId, price: hargaSatuan, quantity: quantity, name: `${event.name.substring(0, 30)} - ${tierName || 'General'}` }]
        };

        const token = await snap.createTransactionToken(parameter);
        res.json({ token, orderId });

    } catch (error) { res.status(500).json({ message: 'Gagal membuat token pembayaran' }); }
});

// 2. API BARU: Simpan Tiket LANGSUNG VALID saat Midtrans sukses
app.post('/api/midtrans-success', async (req, res) => {
    try {
        // 👇 Pastikan 'quantity' ditangkap dari req.body
        const { eventId, userId, customerName, customerEmail, tierName, price, quantity = 1, orderId } = req.body;
        
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ success: false, message: "Event tidak ditemukan" });

        // ... (Kode bikin tiket biarkan sama) ...

        // 👇 UBAH BAGIAN INI: Kurangi Kursi Event & Tipe Tiket sesuai quantity
        event.availableSeats -= quantity; 
        if (tierName && event.tickets && event.tickets.length > 0) {
            const selectedTierIndex = event.tickets.findIndex(t => t.tierName === tierName);
            if (selectedTierIndex !== -1) {
                event.tickets[selectedTierIndex].availableSeats -= quantity; 
            }
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

// ==========================================
// --- API KODE PROMO ---
// ==========================================

// 1. Cek Kode Promo (Dipakai User saat beli)
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

// 2. Lihat Semua Promo (Dipakai Admin Dashboard)
app.get('/api/promos', async (req, res) => {
    try {
        const promos = await Promo.find().sort({ _id: -1 });
        res.json(promos);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. Buat Promo Baru (Dipakai Admin Dashboard)
app.post('/api/promos', async (req, res) => {
    try {
        const { code, discount, quota, daysActive } = req.body;
        
        // Hitung tanggal kadaluarsa
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(daysActive));

        const newPromo = new Promo({ code, discount, quota, expiresAt });
        await newPromo.save();
        
        res.json({ success: true, message: "Promo berhasil dibuat!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Hapus Promo (Dipakai Admin Dashboard)
app.delete('/api/promos/:id', async (req, res) => {
    try {
        await Promo.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Promo dihapus!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
