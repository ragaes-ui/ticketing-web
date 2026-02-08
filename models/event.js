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
    }
    
    // ---------------------------
    
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
