const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    price: { type: Number, required: true },
    totalCapacity: { type: Number, required: true },
    availableSeats: { type: Number, required: true },
    
    // --- FITUR LOCK SUDAH DIHAPUS ---
    
    description: { type: String, default: "" },
    category: { type: String, default: 'General' },
    location: { type: String, default: 'TBA' }
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
