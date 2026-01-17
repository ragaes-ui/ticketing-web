const path = require('path'); // Wajib ada di paling atas
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const midtransClient = require('midtrans-client');

// --- LIBRARY GOOGLE LOGIN ---
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// --- MODEL DATABASE ---
// Pastikan nama file model ini sesuai dengan yang ada di folder models
const User = require('./models/users'); 
const Order = require('./models/order'); 
const Event = require('./models/event');
const Config = require('./models/config');

const app = express();

// Middleware Dasar
app.use(cors());
app.use(express.json());

// ⚠️ UPDATE PENTING: Paksa Vercel cari folder public di root
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// --- KONFIGURASI SESSION & PASSPORT ---
app.use(session({
    secret: 'rcelltech-auth-rcellfest', 
    resave: false,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

// --- KONEKSI DATABASE ---
mongoose.connect("mongodb+srv://konser_db:raga151204@cluster0.rutgg.mongodb.net/konser_db?retryWrites=true&w=majority")
  .then(() => console.log('✅ DATABASE NYAMBUNG BANG!'))
  .catch(err => console.log('❌ Gagal Konek:', err));

// ==========================================
// KONFIGURASI MIDTRANS
// ==========================================
let snap = new midtransClient.Snap({
    isProduction : false, 
    serverKey : 'SB-Mid-server-bJeyNsEecyuBT4Lm6KC55-zg' 
});

// ==========================================
// KONFIGURASI GOOGLE STRATEGY
// ==========================================
passport.use(new GoogleStrategy({
    clientID: "366556901765-pdld1bmsv3afffsp758t09c2v5kar22s.apps.googleusercontent.com", 
    clientSecret: "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", 
    callbackURL: "/auth/google/callback"
  },
  async function(accessToken, refreshToken, profile, cb) {
    try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
            user = await User.findOne({ email: profile.emails[0].value });
            if (user) {
                user.googleId = profile.id;
                await user.save();
            } else {
                user = new User({
                    username: profile.displayName,
                    email: profile.emails[0].value,
                    googleId: profile.id,
                    fullName: profile.displayName,
                    role: 'user'
                });
                await user.save();
            }
        }
        return cb(null, user);
    } catch (err) {
        return cb(err, null);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    User.findById(id).then(user => done(null, user));
});


// --- ROUTES API ---

app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.find();
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/events/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ error: "ID Konser gak valid" });
        const updatedEvent = await Event.findByIdAndUpdate(id, req.body, { new: true }); 
        res.json({ message: "Sukses update!", data: updatedEvent });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/events/:id', async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ message: "Terhapus!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ROUTE AUTH ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/user-login.html' }),
  function(req, res) {
    const user = req.user;
    const token = "token-google-" + user._id;
    const userData = JSON.stringify({
        id: user._id, username: user.username, email: user.email, role: user.role, fullName: user.fullName
    });
    res.redirect(`/google-success.html?token=${token}&userData=${encodeURIComponent(userData)}`);
  });

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, fullName, phone } = req.body;
        const cekEmail = await User.findOne({ email });
        if(cekEmail) return res.status(400).json({ message: "Email sudah terdaftar!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, role: role || 'user', fullName, phone });
        await newUser.save();
        res.json({ success: true, message: "Registrasi Berhasil!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user) return res.status(400).json({ success: false, message: "Akun tidak ditemukan" });
        if (!user.password) return res.status(400).json({ success: false, message: "Silakan login menggunakan Google" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Password salah" });

        res.json({ 
            success: true, 
            token: "token-rahasia-" + user._id,
            user: { id: user._id, username: user.username, email: user.email, role: user.role, fullName: user.fullName, phone: user.phone }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/my-tickets', async (req, res) => {
    try {
        const tickets = await Order.find({ email: req.body.email, status: { $in: ['valid', 'used'] } }).populate('eventId');
        res.json(tickets);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/payment-token', async (req, res) => {
    try {
        const { eventId, customerName, customerEmail, quantity } = req.body;
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        const orderId = "ORDER-" + new Date().getTime();
        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: event.price * quantity },
            customer_details: { first_name: customerName, email: customerEmail },
            item_details: [{ id: eventId, price: event.price, quantity: quantity, name: event.name.substring(0, 50) }]
        };
        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token, orderId: orderId });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/order', async (req, res) => {
    try {
        const { eventId, quantity, customerName, customerEmail } = req.body;
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        const ticketCode = `RCELL-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        const newOrder = new Order({ ticketCode, eventId, customerName, email: customerEmail, status: 'valid' });
        await newOrder.save();
        event.availableSeats -= quantity;
        await event.save();
        res.json({ message: "Order Berhasil", ticketCode });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/payment-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;
        let fraudStatus = statusResponse.fraud_status;

        const order = await Order.findOne({ orderIdMidtrans: orderId });
        if (!order) return res.status(404).json({message: "Order not found"});

        if (transactionStatus == 'capture'){
            if (fraudStatus == 'challenge') order.status = 'pending';
            else if (fraudStatus == 'accept') order.status = 'valid';
        } else if (transactionStatus == 'settlement'){
            order.status = 'valid';
            const event = await Event.findById(order.eventId);
            if(event) { event.availableSeats -= 1; await event.save(); }
        } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
            order.status = 'failed';
        } else if (transactionStatus == 'pending'){
            order.status = 'pending';
        }
        await order.save();
        res.status(200).send('OK');
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/validate', async (req, res) => {
    try {
        const ticket = await Order.findOne({ ticketCode: req.body.ticketCode.trim() }).populate('eventId');
        if (!ticket) return res.status(404).json({ valid: false, message: "TIKET TIDAK DITEMUKAN! ❌" });
        if (ticket.status === 'used') return res.status(400).json({ valid: false, message: "TIKET SUDAH DIPAKAI! ⚠️", detail: `Oleh: ${ticket.customerName}` });

        ticket.status = 'used';
        await ticket.save();
        res.json({ valid: true, message: "TIKET VALID! SILAKAN MASUK ✅", data: { name: ticket.customerName, event: ticket.eventId?.name } });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/user/update-name', async (req, res) => {
    try {
        const user = await User.findById(req.body.userId);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });
        user.username = req.body.newName;
        if(user.fullName) user.fullName = req.body.newName;
        await user.save();
        res.json({ success: true, message: "Nama berhasil diubah" });
    } catch (error) { res.status(500).json({ message: "Gagal update", error: error.message }); }
});

app.put('/api/user/change-password', async (req, res) => {
    try {
        const { userId, oldPassword, newPassword } = req.body;
        const user = await User.findById(userId);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Password lama salah!" });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: "Password berhasil diganti" });
    } catch (error) { res.status(500).json({ message: "Gagal ganti pass", error: error.message }); }
});

app.get('/api/maintenance', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'maintenance' });
        if (!config) {
            config = new Config({ key: 'maintenance', isActive: false });
            await config.save();
        }
        res.json(config);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/maintenance', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'maintenance' });
        if (!config) config = new Config({ key: 'maintenance', isActive: req.body.isActive });
        else config.isActive = req.body.isActive;
        await config.save();
        res.json({ success: true, status: config.isActive ? "MAINTENANCE ON" : "WEBSITE ONLINE" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 🔥 ROUTE KHUSUS BUAT DEBUGGING VERCEL 🔥
// Akses ini kalau web masih blank/error 500
// ==========================================
app.get('/cek-server', (req, res) => {
    const fs = require('fs');
    let output = {};
    
    output.cwd = process.cwd();
    output.publicPath = path.join(process.cwd(), 'public');
    
    try {
        output.filesInPublic = fs.readdirSync(output.publicPath);
        output.status = "✅ Folder Public DITEMUKAN!";
    } catch (e) {
        output.status = "❌ Folder Public GAK KETEMU!";
        output.error = e.message;
        
        // Coba cek folder root isinya apa aja
        try {
            output.filesInRoot = fs.readdirSync(process.cwd());
        } catch (e2) {
            output.filesInRoot = "Gak bisa baca root juga: " + e2.message;
        }
    }
    res.json(output);
});

// ==========================================
// ⚠️ ROUTE PENYELAMAT (CATCH-ALL)
// ==========================================
app.get('*', (req, res) => {
    // 1. Jangan handle request API
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
        return res.status(404).json({ error: 'Not Found' });
    }
    
    // 2. Coba kirim file index.html dengan Error Handling
    const indexPath = path.join(process.cwd(), 'public', 'index.html');
    
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error("Gagal kirim index.html:", err);
            // Kalau gagal, kasih pesan error yang jelas di browser
            res.status(500).send(`
                <div style="font-family: sans-serif; padding: 20px; text-align: center;">
                    <h1>💀 ERROR 500: Server Gagal Baca File</h1>
                    <p>File <b>index.html</b> tidak ditemukan di:</p>
                    <code style="background: #eee; padding: 5px;">${indexPath}</code>
                    <br><br>
                    <p><b>Solusi:</b></p>
                    <ol style="display: inline-block; text-align: left;">
                        <li>Pastikan folder <b>public</b> ter-upload ke GitHub.</li>
                        <li>Cek file <b>vercel.json</b> apakah sudah ada "includeFiles".</li>
                        <li>Coba buka link: <a href="/cek-server">/cek-server</a> untuk diagnosa.</li>
                    </ol>
                </div>
            `);
        }
    });
});

const PORT = process.env.PORT || 5000;
module.exports = app;
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
