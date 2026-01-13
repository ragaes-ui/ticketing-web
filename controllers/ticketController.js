const Event = require('../models/event');
const Order = require('../models/order');

// 1. Tambah Konser (Buat Admin)
exports.createEvent = async (req, res) => {
  try {
    const { name, date, price, capacity } = req.body;
    const newEvent = new Event({
      name, date, price,
      totalCapacity: capacity,
      availableSeats: capacity
    });
    await newEvent.save();
    res.status(201).json(newEvent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. Lihat Semua Konser
exports.getEvents = async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3. Beli Tiket (Logic Anti-Bentrok)
exports.buyTicket = async (req, res) => {
  try {
    const { eventId, quantity, customerName, customerEmail } = req.body;

    // Cari event DAN kurangi stok dalam satu perintah (Atomic)
    const event = await Event.findOneAndUpdate(
      { _id: eventId, availableSeats: { $gte: quantity } }, 
      { $inc: { availableSeats: -quantity } }, 
      { new: true }
    );

    if (!event) {
      return res.status(400).json({ message: 'Tiket Habis / Stok Kurang' });
    }

    const totalPrice = event.price * quantity;
    const ticketCode = `TIKET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const order = new Order({
      eventId, customerName, customerEmail, quantity, totalPrice, ticketCode
    });

    await order.save();

    res.status(201).json({ message: 'Berhasil', ticket: order });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};