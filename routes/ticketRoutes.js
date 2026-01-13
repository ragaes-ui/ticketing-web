const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

router.post('/events', ticketController.createEvent);
router.get('/events', ticketController.getEvents);
router.post('/order', ticketController.buyTicket);

module.exports = router;