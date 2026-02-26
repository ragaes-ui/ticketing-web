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
    
    // Kategori: 'Konser', 'Olahraga', 'Workshop', 'Streaming'
    category: { 
        type: String, 
        default: 'General' 
    },
    
    // Lokasi: Nama Gedung (Event) atau Platform (Streaming)
    location: { 
        type: String, 
        default: 'TBA' 
    }, 
      // --- TAMBAHKAN BARIS INI ---
    image: { 
        type: String, 
        default: "" 
    },
    // 👇 --- TAMBAHAN BARU UNTUK TIPE TIKET (TIERING) --- 👇
    // Array ini akan menyimpan macam-macam jenis tiket di dalam 1 event
    tickets: [{
        tierName: { type: String, required: true },      // Contoh: "Presale 1", "VIP", atau "Sharing 1 Bulan"
        price: { type: Number, required: true },         // Harga spesifik untuk kategori ini
        totalSeats: { type: Number, required: true },    // Kuota khusus kategori ini
        availableSeats: { type: Number, required: true } // Sisa tiket kategori ini
    }]
    // ----------------------------------------------------
    
    // ---------------------------
    
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
