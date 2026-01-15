require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
// 1. IMPORT MIDTRANS
const midtransClient = require('midtrans-client');

// --- PERHATIKAN HURUF BESAR/KECIL NAMA FILE ---
const User = require('./models/users'); 
const Order = require('./models/order'); 
const Event = require('./models/event');
const Config = require('./models/config');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- KONEKSI DATABASE ---
mongoose.connect("mongodb+srv://konser_db:raga151204@cluster0.rutgg.mongodb.net/konser_db?retryWrites=true&w=majority")
  .then(() => console.log('✅ DATABASE NYAMBUNG BANG!'))
  .catch(err => console.log('❌ Gagal Konek:', err));

// ==========================================
// KONFIGURASI MIDTRANS
// ==========================================
let snap = new midtransClient.Snap({
    isProduction : false, // Pastikan ini false (Sandbox)
    // GUNAKAN KUNCI YANG AWALANNYA 'SB-Mid-server-...'
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
        // Hanya tampilkan tiket yang statusnya 'valid' atau 'used' (jangan tampilkan yang pending/belum bayar)
        const tickets = await Order.find({ 
            email: email, 
            status: { $in: ['valid', 'used'] } 
        }).populate('eventId');
        res.json(tickets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 4. ORDER / BELI TIKET (UPDATED FOR MIDTRANS)
// ==========================================
app.post('/api/order', async (req, res) => {
    try {
        const { eventId, quantity, customerName, customerEmail } = req.body;
        
        // 1. Cek Ketersediaan Tiket
        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ message: "Event tidak ditemukan" });
        
        // Cek stok (optional: dikurangi nanti saat payment sukses atau sekarang)
        // Untuk Midtrans lebih aman cek stok dulu tapi jangan kurangi permanen sampai bayar
        if(event.availableSeats < quantity) {
            return res.status(400).json({ message: "Tiket Habis!" });
        }

        // 2. Hitung Total Harga
        const grossAmount = event.price * quantity;
        
        // 3. Buat Order ID Unik
        // Format: RCELL-{timestamp}-{random} biar unik
        const orderId = `RCELL-${new Date().getTime()}-${Math.floor(Math.random() * 1000)}`;
        
        // 4. Buat Tiket Code Sementara (Nanti diaktifkan setelah bayar)
        const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
        const ticketCode = "TICKET-" + randomStr;

        // 5. Simpan Order ke Database status 'pending'
        const newOrder = new Order({
            ticketCode,
            eventId,
            customerName,
            email: customerEmail,
            status: 'pending', // Status awal pending
            orderIdMidtrans: orderId // Simpan order ID Midtrans buat referensi nanti
        });
        await newOrder.save();

        // 6. Siapkan Parameter Midtrans
        let parameter = {
            "transaction_details": {
                "order_id": orderId,
                "gross_amount": grossAmount
            },
            "credit_card":{
                "secure" : true
            },
            "customer_details": {
                "first_name": customerName,
                "email": customerEmail,
            },
            "item_details": [
                {
                    "id": event._id.toString(),
                    "price": event.price,
                    "quantity": quantity,
                    "name": event.name.substring(0, 50) // Midtrans limit nama item 50 char
                }
            ]
        };

        // 7. Minta Token ke Midtrans
        const transaction = await snap.createTransaction(parameter);
        
        // 8. Kirim Token ke Frontend
        res.json({ 
            token: transaction.token,
            orderId: orderId
        });

    } catch (err) {
        console.error("Midtrans Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ==========================================
// 5. WEBHOOK / NOTIFICATION (WAJIB BUAT UPDATE STATUS)
// ==========================================
// Endpoint ini akan dipanggil otomatis oleh Midtrans saat user sudah bayar
app.post('/api/payment-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;
        let fraudStatus = statusResponse.fraud_status;

        console.log(`Transaction notification received. Order ID: ${orderId}. Transaction status: ${transactionStatus}. Fraud status: ${fraudStatus}`);

        // Cari Order di Database berdasarkan orderIdMidtrans
        const order = await Order.findOne({ orderIdMidtrans: orderId });
        
        if (!order) {
            return res.status(404).json({message: "Order not found"});
        }

        // Logic Update Status
        if (transactionStatus == 'capture'){
            if (fraudStatus == 'challenge'){
                order.status = 'pending';
            } else if (fraudStatus == 'accept'){
                order.status = 'valid'; // SUKSES KARTU KREDIT
                // Kurangi stok disini jika perlu
            }
        } else if (transactionStatus == 'settlement'){
            order.status = 'valid'; // SUKSES (GOPAY/QRIS/VA)
            
            // Kurangi stok tiket saat lunas
            const event = await Event.findById(order.eventId);
            if(event) {
                event.availableSeats -= 1; 
                await event.save();
            }
        } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire'){
            order.status = 'failed'; // GAGAL
        } else if (transactionStatus == 'pending'){
            order.status = 'pending'; // MENUNGGU
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
        
        // Cek apakah status valid (sudah dibayar)
        if (ticket.status === 'pending') return res.status(400).json({ valid: false, message: "TIKET BELUM DIBAYAR! 💰" });
        if (ticket.status === 'failed') return res.status(400).json({ valid: false, message: "TRANSAKSI GAGAL/BATAL! ❌" });
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
// 1. Cek Status (Dipakai oleh halaman depan & admin)
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

// 2. Ubah Status (Dipakai oleh Admin)
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
