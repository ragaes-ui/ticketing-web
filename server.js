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
const User = require('./models/users'); 
const Order = require('./models/order'); 
const Event = require('./models/event');
const Config = require('./models/config');

const app = express();

// Middleware Dasar
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- KONFIGURASI SESSION & PASSPORT (WAJIB BUAT GOOGLE) ---
app.use(session({
    secret: 'rcelltech-auth-rcellfest', // Boleh diganti bebas
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
    clientID: "366556901765-pdld1bmsv3afffsp758t09c2v5kar22s.apps.googleusercontent.com", // <--- GANTI INI
    clientSecret: "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", // <--- GANTI INI
    callbackURL: "/auth/google/callback"
  },
  async function(accessToken, refreshToken, profile, cb) {
    try {
        // 1. Cek apakah user sudah ada berdasarkan Google ID
        let user = await User.findOne({ googleId: profile.id });
        
        // 2. Kalau belum, cek emailnya
        if (!user) {
            user = await User.findOne({ email: profile.emails[0].value });
            
            if (user) {
                // Email ada, sambungkan Google ID
                user.googleId = profile.id;
                await user.save();
            } else {
                // User baru, buat akun
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

// Serialize User untuk Session
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    User.findById(id).then(user => done(null, user));
});


// --- ROUTES API ---

// 1. Ambil Semua Konser
app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.find();
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Tambah Konser Baru (Create)
app.post('/api/events', async (req, res) => {
    try {
        const { name, date, price, capacity, description, category, location } = req.body;
        
        const newEvent = new Event({
            name,
            date,
            price,
            totalCapacity: capacity,
            availableSeats: capacity,
            description: description || "",
            category: category || "General",
            location: location || "TBA"
        });
        await newEvent.save();
        res.json(newEvent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Update Konser (Edit)
app.put('/api/events/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, date, price, capacity, availableSeats, description, category, location } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ error: "ID Konser gak valid" });
        }

        const updatedEvent = await Event.findByIdAndUpdate(id, { 
            name, 
            date, 
            price, 
            totalCapacity: capacity,
            availableSeats: availableSeats,
            description: description,
            category: category,
            location: location 
        }, { new: true }); 

        res.json({ message: "Sukses update!", data: updatedEvent });
    } catch (error) {
        console.error("Error Update:", error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Hapus Konser
app.delete('/api/events/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Event.findByIdAndDelete(id);
        res.json({ message: "Terhapus!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ROUTE KHUSUS GOOGLE LOGIN ---

// A. Tombol Login Google Ditekan
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }));

// B. Google Balikin User ke Server
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/user-login.html' }),
  function(req, res) {
    const user = req.user;
    
    // Siapkan data token manual
    const token = "token-google-" + user._id;
    
    const userData = JSON.stringify({
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: user.fullName
    });
    
    // Redirect ke halaman perantara
    res.redirect(`/google-success.html?token=${token}&userData=${encodeURIComponent(userData)}`);
  });


// --- 1. REGISTER USER BARU ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, fullName, phone } = req.body;
        
        const cekEmail = await User.findOne({ email });
        if(cekEmail) return res.status(400).json({ message: "Email sudah terdaftar!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({ 
            username, 
            email, 
            password: hashedPassword,
            role: role || 'user',
            fullName: fullName, 
            phone: phone
        });
        
        await newUser.save();
        res.json({ success: true, message: "Registrasi Berhasil! Silakan Login." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 2. LOGIN MANUAL ---
app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        
        const user = await User.findOne({ 
            $or: [{ username: identifier }, { email: identifier }] 
        });
        
        if (!user) return res.status(400).json({ success: false, message: "Akun tidak ditemukan" });

        // Kalau user login pake password tapi akunnya akun Google (password kosong)
        if (!user.password) return res.status(400).json({ success: false, message: "Silakan login menggunakan Google" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Password salah" });

        res.json({ 
            success: true, 
            token: "token-rahasia-" + user._id,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                fullName: user.fullName || user.username, 
                phone: user.phone || ""
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 3. API DASHBOARD USER ---
app.post('/api/my-tickets', async (req, res) => {
    try {
        const { email } = req.body;
        const tickets = await Order.find({ 
            email: email, 
            status: { $in: ['valid', 'used'] } 
        }).populate('eventId');
        res.json(tickets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 4. API MINTA TOKEN PEMBAYARAN (MIDTRANS) ---
app.post('/api/payment-token', async (req, res) => {
    try {
        const { eventId, customerName, customerEmail, quantity } = req.body;
        
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        const grossAmount = event.price * quantity;
        const orderId = "ORDER-" + new Date().getTime();

        let parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: grossAmount
            },
            credit_card:{ secure : true },
            customer_details: {
                first_name: customerName,
                email: customerEmail
            },
            item_details: [{
                id: eventId,
                price: event.price,
                quantity: quantity,
                name: event.name.substring(0, 50)
            }]
        };

        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token, orderId: orderId });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
});

// --- 5. ORDER / SIMPAN DATABASE ---
app.post('/api/order', async (req, res) => {
    try {
        const { eventId, quantity, customerName, customerEmail } = req.body;
        
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        // Buat Tiket Code
        const ticketCode = `RCELL-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        const newOrder = new Order({
            ticketCode,
            eventId,
            customerName,
            email: customerEmail,
            status: 'valid' // Asumsi kalau masuk sini berarti sudah bayar via Frontend Snap
        });
        await newOrder.save();

        // Kurangi Stok
        event.availableSeats -= quantity;
        await event.save();

        res.json({ message: "Order Berhasil", ticketCode });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API CEK TIKET (VALIDASI) ---
app.post('/api/validate', async (req, res) => {
    try {
        const { ticketCode } = req.body;
        const ticket = await Order.findOne({ ticketCode: ticketCode.trim() }).populate('eventId');

        if (!ticket) return res.status(404).json({ valid: false, message: "TIKET TIDAK DITEMUKAN! ❌" });
        if (ticket.status === 'used') return res.status(400).json({ valid: false, message: "TIKET SUDAH DIPAKAI! ⚠️", detail: `Oleh: ${ticket.customerName}` });

        ticket.status = 'used';
        await ticket.save();

        res.json({ 
            valid: true, 
            message: "TIKET VALID! SILAKAN MASUK ✅", 
            data: { name: ticket.customerName, event: ticket.eventId ? ticket.eventId.name : 'Event Tidak Diketahui' }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API PROFILE USER ---
app.put('/api/user/update-name', async (req, res) => {
    try {
        const { userId, newName } = req.body;
        const user = await User.findById(userId);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });

        user.username = newName;
        if(user.fullName) user.fullName = newName;
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

// --- API MAINTENANCE MODE ---
app.get('/api/maintenance', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'maintenance' });
        if (!config) {
            config = new Config({ key: 'maintenance', isActive: false });
            await config.save();
        }
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/maintenance', async (req, res) => {
    try {
        const { isActive } = req.body;
        let config = await Config.findOne({ key: 'maintenance' });

        if (!config) {
            config = new Config({ key: 'maintenance', isActive: isActive });
        } else {
            config.isActive = isActive;
        }

        await config.save();
        res.json({ success: true, status: config.isActive ? "MAINTENANCE ON" : "WEBSITE ONLINE" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
module.exports = app; 
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
