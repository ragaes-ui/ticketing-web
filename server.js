const path = require('path'); // Wajib ada di paling atas
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

// Middleware Dasar
app.use(cors());
app.use(express.json());

// ⚠️ UPDATE PENTING: Biar Vercel gak bingung cari folder public
app.use(express.static(path.join(process.cwd(), 'public')));

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

        // Cek password
        if (!user.password) {
            // Ini jaga-jaga kalau ada user lama yang dulu daftar pake Google trus mau login manual
            return res.status(400).json({ success: false, message: "Akun ini terdaftar via Google. Silakan reset password jika ingin login manual." });
        }

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

// --- 6. WEBHOOK NOTIFICATION (MIDTRANS) ---
app.post('/api/payment-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;
        let fraudStatus = statusResponse.fraud_status;

        console.log(`Transaction notification received. Order ID: ${orderId}. Transaction status: ${transactionStatus}.`);

        const order = await Order.findOne({ orderIdMidtrans: orderId });
        
        if (!order) {
            return res.status(404).json({message: "Order not found"});
        }

        if (transactionStatus == 'capture'){
            if (fraudStatus == 'challenge'){
                order.status = 'pending';
            } else if (fraudStatus == 'accept'){
                order.status = 'valid';
            }
        } else if (transactionStatus == 'settlement'){
            order.status = 'valid';
            
            // Kurangi stok tiket saat lunas (opsional, kalau belum dikurangi di atas)
            const event = await Event.findById(order.eventId);
            if(event) {
                event.availableSeats -= 1; 
                await event.save();
            }
        } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
            order.status = 'failed';
        } else if (transactionStatus == 'pending'){
            order.status = 'pending';
        }

        await order.save();
        res.status(200).send('OK');

    } catch (error) {
        console.error("Notification Error:", error.message);
        res.status(500).json({ error: error.message });
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

// ==========================================
// ⚠️ ROUTE PENYELAMAT (CATCH-ALL)
// WAJIB DITARUH PALING BAWAH (SEBELUM APP.LISTEN)
// ==========================================
app.get('*', (req, res) => {
    // Kecuali kalau dia mau akses API, jangan ditimpa
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not Found' });
    }
    // Sisanya (Halaman Web) kasih index.html
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
module.exports = app; 
app.listen(PORT, () => console.log(`🚀 Server jalan di port ${PORT}`));
