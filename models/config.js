const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    key: { type: String, default: 'maintenance' }, // Penanda
    isActive: { type: Boolean, default: false }    // false = Website Nyala, true = Maintenance
});

module.exports = mongoose.model('Config', configSchema);

