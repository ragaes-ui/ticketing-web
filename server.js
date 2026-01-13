require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const User = require('./models/users'); // Pastikan file models/User.js ada
const Order = require('./models/order'); // <--- TAMBAH INI

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- KONEKSI DATABASE ---
// Ganti password sesuai punya Abang kalau beda
mongoose.connect("mongodb+srv://konser_db:raga151204@cluster0.rutgg.mongodb.net/konser_db?retryWrites=true&w=majority")
  .then(() => console.log('✅ DATABASE NYAMBUNG BANG!'))
  .catch(err => console.log('❌ Gagal Konek:', err));

// --- DEFINISI SCHEMA KONSER (Supaya Server Kenal "Event") ---
const eventSchema = new mongoose.Schema({
    name: String,
    date: Date,
    price: Number,
    totalCapacity: Number,
    availableSeats: Number
});

// Kalau di database namanya 'events', Mongoose otomatis cocokin
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

// 2. Tambah Konser Baru
app.post('/api/events', async (req, res) => {
    try {
        const { name, date, price, capacity } = req.body;
        const newEvent = new Event({
            name,
            date,
            price,
            totalCapacity: capacity,
            availableSeats: capacity // Awal dibuat, stok = kapasitas
        });
        await newEvent.save();
        res.json(newEvent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Update Konser (EDIT) - Kode yang tadi bikin error
app.put('/api/events/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, date, price, capacity, availableSeats } = req.body;

        // Cek dulu ID-nya valid gak
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ error: "ID Konser gak valid" });
        }

        const updatedEvent = await Event.findByIdAndUpdate(id, { 
            name, 
            date, 
            price, 
            totalCapacity: capacity,
            availableSeats: availableSeats 
        }, { new: true }); // {new: true} biar data balikan adalah yg terbaru

        res.json({ message: "Sukses update!", data: updatedEvent });
    } catch (error) {
        console.error("Error Update:", error); // Muncul di terminal
        res.status(500).json({ error: error.message }); // Muncul di browser
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

// 5. Login Admin
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) return res.status(400).json({ success: false, message: "Username tidak ditemukan" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Password salah" });

        res.json({ success: true, token: "admin-token-rahasia" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Register Admin (Buat nambah user lewat console)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.json({ message: "Admin dibuat!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/order', async (req, res) => {
    try {
        const { eventId, quantity, customerName, customerEmail } = req.body;
        
        // 1. Cek & Kurangi Stok
        const event = await Event.findById(eventId);
        if(event.availableSeats < quantity) {
            return res.status(400).json({ message: "Tiket Habis!" });
        }
        event.availableSeats -= quantity;
        await event.save();

        // 2. Buat Kode Tiket Unik
        // Kita bikin kode simpel: TIKET-[JAM]-[ANGKA_ACAK]
        const ticketCode = "TIKET-" + Date.now() + Math.floor(Math.random() * 1000);

        // 3. Simpan Tiket ke Database (PENTING BUAT VALIDASI)
        const newOrder = new Order({
            ticketCode,
            eventId,
            customerName,
            email: customerEmail,
            status: 'valid' // Awal beli statusnya masih valid
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
        
        // 1. CCTV: Laporin kode yang diterima server
        console.log("📡 Menerima Scan Kode:", ticketCode);

        // Cari tiket (Pakai trim() biar spasi hilang)
        const ticket = await Order.findOne({ ticketCode: ticketCode.trim() }).populate('eventId');

        // 2. CCTV: Laporin hasil pencarian
        console.log("🔎 Hasil Pencarian di DB:", ticket);

        if (!ticket) {
            return res.status(404).json({ valid: false, message: "TIKET TIDAK DITEMUKAN! ❌" });
        }

        if (ticket.status === 'used') {
            return res.status(400).json({ valid: false, message: "TIKET SUDAH DIPAKAI! ⚠️", detail: `Oleh: ${ticket.customerName}` });
        }

        // Kalau valid
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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));