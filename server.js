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

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// ==========================================
// 🛠️ FIX KONEKSI DATABASE
// ==========================================
let cached = global.mongoose;
if (!cached) { cached = global.mongoose = { conn: null, promise: null }; }

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const opts = { bufferCommands: false, serverSelectionTimeoutMS: 5000 };
    const MONGO_URI = "mongodb+srv://konser_db:raga151204@cluster0.rutgg.mongodb.net/konser_db?retryWrites=true&w=majority";
    cached.promise = mongoose.connect(MONGO_URI, opts).then((mongoose) => {
      console.log('✅ DATABASE BARU AJA KONEK!');
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

// --- ROUTES API ---

// 🔒 API PUBLIC: SENSOR DESKRIPSI STREAMING
app.get('/api/events', async (req, res) => {
    try { 
        const events = await Event.find(); 
        const publicEvents = events.map(ev => {
            const eventObj = ev.toObject();
            // SENSOR PASSWORD DI SINI
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

// --- API AUTHENTICATION ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, fullName, phone } = req.body;
        const cekEmail = await User.findOne({ email });
        if(cekEmail) return res.status(400).json({ message: "Email sudah terdaftar!" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, role: role || 'user', fullName, phone });
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
        res.json({ success: true, token: "token-rahasia-" + user._id, user: { id: user._id, username: user.username, email: user.email, role: user.role, fullName: user.fullName, phone: user.phone } });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/my-tickets', async (req, res) => {
    try { const tickets = await Order.find({ email: req.body.email, status: { $in: ['valid', 'used'] } }).populate('eventId'); res.json(tickets); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

// --- PAYMENT & ORDER ---

// ✅ API PRIVATE: LIHAT DETAIL ORDER (TERMASUK PASSWORD)
app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const order = await Order.findOne({ orderIdMidtrans: req.params.orderId }).populate('eventId');
        if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

        let responseData = {
            status: order.status,
            productName: order.eventId?.name,
            customerName: order.customerName,
            credentials: null 
        };

        // HANYA JIKA LUNAS, KIRIM PASSWORD ASLI
        if (order.status === 'valid' || order.status === 'used') {
            responseData.credentials = order.eventId?.description;
        }

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
            ticketCode: ticketCode,
            eventId: eventId,
            customerName: customerName,
            email: customerEmail,
            status: 'pending',       
            orderIdMidtrans: orderId 
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

app.post('/api/payment-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;
        let fraudStatus = statusResponse.fraud_status;

        const order = await Order.findOne({ orderIdMidtrans: orderId });
        if (!order) return res.status(404).json({message: "Order not found"});

        if (transactionStatus == 'capture' || transactionStatus == 'settlement'){
            if (fraudStatus == 'challenge') {
                order.status = 'pending';
                await order.save();
            } else {
                order.status = 'valid';
                const event = await Event.findById(order.eventId);
                if(event) { event.availableSeats -= 1; await event.save(); }
                await order.save();
            }
        } 
        else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
            await Order.findOneAndDelete({ orderIdMidtrans: orderId });
        } 
        else if (transactionStatus == 'pending'){
            order.status = 'pending';
            await order.save();
        }
        res.status(200).send('OK');
    } catch (error) { res.status(500).json({ error: error.message }); }
});

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

app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});
// Handler untuk 404 (Taruh Paling Bawah)
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 5000;
module.exports = app;
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
