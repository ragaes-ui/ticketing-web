const mongoose = require('mongoose'); // 'const' harus huruf kecil

const eventSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    date: { 
        type: Date, 
        required: true 
    },
    price: { 
        type: Number, 
        required: true 
    },
    totalCapacity: { 
        type: Number, 
        required: true 
    },
    availableSeats: { 
        type: Number, 
        required: true 
    },
    
    // --- 👇 FITUR LOCK (PENTING) 👇 ---
    isOpen: { 
        type: Boolean, 
        default: true 
    }, // <--- JANGAN LUPA KOMA INI (PENTING!)
    // ----------------------------------

    // --- KOLOM TAMBAHAN ---
    description: { 
        type: String, 
        default: "" 
    },
    category: { 
        type: String, 
        default: 'General' 
    },
    location: { 
        type: String, 
        default: 'TBA' 
    }
}, { timestamps: true }); // Opsional: Biar ada created_at & updated_at

module.exports = mongoose.model('Event', eventSchema);
