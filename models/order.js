const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  // Kode Tiket (misal: TICKET-AB123)
  ticketCode: { type: String, required: true, unique: true }, 
  
  // Relasi ke Event
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, 

  price: { type: Number, required: true },
  tierName: { type: String, default: 'General' },
  customerName: String,
  email: String,
  phone: String, // 👈 TAMBAHAN: Untuk menyimpan No. WhatsApp
  nik: String,   // 👈 TAMBAHAN: Untuk menyimpan NIK KTP (Opsional)
  
  // PENTING: Update status agar mendukung flow pembayaran
  status: { 
    type: String, 
    default: 'pending', // Default 'pending' dulu sebelum dibayar
    enum: ['pending', 'valid', 'used', 'failed'] // Pilihan status yang diizinkan
  },
  
  // PENTING: Field baru untuk menyimpan ID unik transaksi Midtrans
  // Nanti dipakai buat mencocokkan pembayaran yang masuk
  orderIdMidtrans: { type: String },
  quantity : { type: Number, default: 1}, 
  
  purchaseDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
