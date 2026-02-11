const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    device: {
        type: String,
        default: "Unknown Device"
    },
    ip: {
        type: String,
        default: "0.0.0.0"
    },
    timestamp: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('LoginHistory', historySchema);
