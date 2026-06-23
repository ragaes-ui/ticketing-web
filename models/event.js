const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    // Nama Event / Produk (Misal: Konser Noah / Netflix Premium)
    name: { 
        type: String, 
        required: true 
    },
    
    // Tanggal Event / Masa Aktif Akun
    date: { 
        type: Date, 
        required: true 
    },
    // 🔥 TAMBAHAN BARU: JAM EVENT 🔥
    startTime: {
        type: String, // Tipe String untuk menyimpan format "HH:mm" (cth: "19:00")
        default: ""
    },
    endTime: {
        type: String, 
        default: ""
    },
    salesOpenDate: { 
        type: Date, 
        default: "" 
    },
    // -----------------------------
    
    // Harga (Rupiah)
    price: { 
        type: Number, 
        required: true 
    },
    
    // Total Stok Awal
    totalCapacity: { 
        type: Number, 
        required: true 
    },
    
    // Sisa Stok (Akan berkurang otomatis saat dibeli)
    availableSeats: { 
        type: Number, 
        required: true 
    },
    
    // DESKRIPSI (FIELD KUNCI):
    // 1. Jika Konser: Isi info acara biasa.
    // 2. Jika Streaming: Isi EMAIL & PASSWORD (Server akan otomatis menyensor ini di halaman depan).
    description: { 
        type: String, 
        default: "" 
    },
    // 🔥 TAMBAHAN BARU: DATA RAHASIA (STREAMING) 🔥
    // Berisi Email & Password yang HANYA muncul setelah user bayar
    secretData: {
        type: String,
        default: ""
    },
    // Kategori: 'Konser', 'Olahraga', 'Workshop', 'Streaming'
    category: { 
        type: String, 
        default: 'General' 
    },
    organizer: {
        type: String,
        default: ""
    },
    
    // Lokasi: Nama Gedung (Event) atau Platform (Streaming)
    location: { 
        type: String, 
        default: 'TBA' 
    }, 
    mapsUrl: {
        type: String,
        default: ""
    },// 👈 TAMBAHKAN BARIS INI
      // --- TAMBAHKAN BARIS INI ---
    image: { 
        type: String, 
        default: "" 
    },
    // 👇 --- TAMBAHAN BARU UNTUK POSTER LINE UP ARTIS --- 👇
    lineupImages: {
        type: [String], // Array karena posternya bisa lebih dari satu
        default: []
    },
    // 👆 ------------------------------------------------ 👆
    // 👇 --- TAMBAHAN BARU UNTUK TIPE TIKET (TIERING) --- 👇
    // Array ini akan menyimpan macam-macam jenis tiket di dalam 1 event
    tickets: [{
        tierName: { type: String, required: true },      // Contoh: "Presale 1", "VIP", atau "Sharing 1 Bulan"
        price: { type: Number, required: true },         // Harga spesifik untuk kategori ini
        totalSeats: { type: Number, required: true },    // Kuota khusus kategori ini
        availableSeats: { type: Number, required: true }, // Sisa tiket kategori ini
        minQty: { type: Number, default: 1 }
    }],
    // ----------------------------------------------------
    isPinned: { type: Boolean, default: false }
    // ---------------------------
    
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
