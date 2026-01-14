require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const User = require('./models/user'); // Pastikan nama file modelnya benar (User.js atau users.js)
const Order = require('./models/order'); // Pastikan nama file modelnya benar (Order.js atau order.js)

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- KONEKSI DATABASE ---
// Tips: Sebaiknya connection string ditaruh di .env, tapi hardcode begini jalan buat development.
mongoose.connect("mongodb+srv://konser_db:raga151204@cluster0.rutgg.mongodb.net/konser_db?retryWrites=true&w=majority")
  .then(() => console.log('✅ DATABASE NYAMBUNG BANG!'))
  .catch(err => console.log('❌ Gagal Konek:', err));

// --- DEFINISI SCHEMA KONSER ---
const eventSchema = new mongoose.Schema({
    name: String,
    date: Date,
    price: Number,
    totalCapacity: Number,
    availableSeats: Number,
    description: { type: String, default: "" },
    // 1. TAMBAHAN: Field Category & Location (PERBAIKAN SINTAKS)
    category: { type: String, default: "General" }, 
    location: { type: String, default: "TBA" } // <--- INI CARA NULIS YANG BENAR
});

const Event = mongoose.model('Event', eventSchema); 

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
            description: description,
            category: category, 
            location: location // <--- PERBAIKAN: Pakai titik dua, bukan sama dengan
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
            location: location // <--- PERBAIKAN SINTAKS
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

// --- 2. LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        
        const user = await User.findOne({ 
            $or: [{ username: identifier }, { email: identifier }] 
        });
        
        if (!user) return res.status(400).json({ success: false, message: "Akun tidak ditemukan" });

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
        const tickets = await Order.find({ email: email }).populate('eventId');
        res.json(tickets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 4. ORDER / BELI TIKET ---
app.post('/api/order', async (req, res) => {
    try {
        const { eventId, quantity, customerName, customerEmail } = req.body;
        
        const event = await Event.findById(eventId);
        if(event.availableSeats < quantity) {
            return res.status(400).json({ message: "Tiket Habis!" });
        }
        event.availableSeats -= quantity;
        await event.save();

        // --- UPDATE PENTING: KODE PENDEK BIAR BISA DISCAN ---
        // Format: RCELL-XXXXX (Bukan Timestamp panjang)
        const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
        const ticketCode = "RCELL-" + randomStr;

        const newOrder = new Order({
            ticketCode,
            eventId,
            customerName,
            email: customerEmail,
            status: 'valid'
        });
        await newOrder.save();

        res.json({ 
            message: "Berhasil beli!", 
            ticket: { ticketCode, customerName, eventName: event.name } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API CEK TIKET (VALIDASI) ---
app.post('/api/validate', async (req, res) => {
    try {
        const { ticketCode } = req.body;
        console.log("📡 Menerima Scan Kode:", ticketCode);

        const ticket = await Order.findOne({ ticketCode: ticketCode.trim() }).populate('eventId');
        console.log("🔎 Hasil Pencarian di DB:", ticket);

        if (!ticket) {
            return res.status(404).json({ valid: false, message: "TIKET TIDAK DITEMUKAN! ❌" });
        }

        if (ticket.status === 'used') {
            return res.status(400).json({ valid: false, message: "TIKET SUDAH DIPAKAI! ⚠️", detail: `Oleh: ${ticket.customerName}` });
        }

        ticket.status = 'used';
        await ticket.save();

        res.json({ 
            valid: true, 
            message: "TIKET VALID! SILAKAN MASUK ✅", 
            data: {
                name: ticket.customerName,
                event: ticket.eventId ? ticket.eventId.name : 'Event Tidak Diketahui'
            }
        });

    } catch (error) {
        console.error("❌ Error Validasi:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- TAMBAHAN: UPDATE PROFIL USER ---

// 1. API Ubah Nama
app.put('/api/user/update-name', async (req, res) => {
    try {
        const { userId, newName } = req.body;
        
        const user = await User.findById(userId);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });

        user.username = newName;
        // Kalau mau update fullName juga:
        if(user.fullName) user.fullName = newName; 
        
        await user.save();

        res.json({ success: true, message: "Nama berhasil diubah" });
    } catch (error) {
        res.status(500).json({ message: "Gagal update nama", error: error.message });
    }
});

// 2. API Ganti Password
app.put('/api/user/change-password', async (req, res) => {
    try {
        const { userId, oldPassword, newPassword } = req.body;

        const user = await User.findById(userId);
        if(!user) return res.status(404).json({ message: "User tidak ditemukan" });

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Password lama salah!" });

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedNewPassword;
        await user.save();

        res.json({ success: true, message: "Password berhasil diganti" });
    } catch (error) {
        res.status(500).json({ message: "Gagal ganti password", error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
module.exports = app;
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
