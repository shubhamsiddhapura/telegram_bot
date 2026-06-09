'use strict';

/**
 * routes/admin.js
 * 
 * Defines routing for the admin dashboard endpoints.
 */

const { Router } = require('express');
const adminController = require('../controllers/adminController');

const router = Router();

// Public routes
router.post('/login', adminController.login);

// Protected routes (apply auth middleware)
router.use(adminController.adminAuth);

router.post('/logout', adminController.logout);
router.get('/status', adminController.getStatus);
router.get('/config', adminController.getConfig);
router.post('/config/update', adminController.updateConfig);
router.post('/bot/restart', adminController.restartBot);
router.get('/logs', adminController.getLogs);

// GramJS Telegram Login Wizard routes
router.post('/telegram/login/send-code', adminController.sendTelegramCode);
router.post('/telegram/login/verify-code', adminController.verifyTelegramCode);

module.exports = router;
