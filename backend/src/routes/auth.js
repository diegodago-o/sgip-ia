const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, normalizeRole } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ──
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email inválido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { email, password } = req.body;

      const [rows] = await pool.execute(
        'SELECT * FROM users WHERE email = ? AND is_active = 1',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      }

      const user = rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      }

      await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

      const role = normalizeRole(user.role);

      const token = jwt.sign(
        { id: user.id, email: user.email, role, full_name: user.full_name },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role,
          avatar_url: user.avatar_url,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ── GET /api/auth/me ──
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // req.user.role is already normalized by authMiddleware
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        full_name: req.user.full_name,
        role: req.user.role,
      },
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
