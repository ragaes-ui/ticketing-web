const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    price: { type: Number, required: true },
    totalCapacity: { type: Number, required: true },
    availableSeats: { type: Number, required: true },
    
    // --- KOLOM BARU ---
    description: { type: String },                  // Penjelasan event
    category: { type: String, default: 'General' }, // Kategori (Konser, Olahraga, dll)
    location: { type: String, default: 'TBA' }      // Lokasi (ICE BSD, GBK, dll)
});

module.exports = mongoose.model('Event', eventSchema);
