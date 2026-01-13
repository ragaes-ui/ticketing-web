const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  ticketCode: { type: String, required: true, unique: true }, // Kode Unik (misal: TIKET-172839)
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, // Konser apa?
  customerName: String,
  email: String,
  status: { type: String, default: 'valid' }, // Status: 'valid' atau 'used' (sudah dipakai)
  purchaseDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);