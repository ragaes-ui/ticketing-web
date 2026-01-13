const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, unique: true }, // Tambahan buat User
    password: { type: String, required: true },
    role: { type: String, default: 'user' } // 'admin' atau 'user'
});

module.exports = mongoose.model('User', userSchema);
