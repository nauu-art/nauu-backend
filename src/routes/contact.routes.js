const express = require('express');
const router = express.Router();
const { sendContact, getSentContacts, getReceivedContacts } = require('../controllers/contact.controller');
const { authenticate, requireArtist, optionalAuth } = require('../middleware/auth.middleware');

router.get('/sent', authenticate, getSentContacts);
router.get('/received', authenticate, requireArtist, getReceivedContacts);

// Feedback geral da plataforma — tem de vir antes de /:artistUsername
router.post('/feedback', async (req, res) => {
  try {
    const { name: rn, email: re, message: rm } = req.body
    if (!rn || !re || !rm) return res.status(400).json({ error: 'Campos obrigatórios em falta' })
    const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    const name = esc(rn); const email = esc(re); const message = esc(rm)
    const { sendEmail } = require('../utils/email')
    await sendEmail({
      to: process.env.SMTP_USER,
      subject: `nauu.art — Feedback de ${name}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px">
        <h2 style="color:#111;font-size:18px">Novo feedback recebido</h2>
        <p><strong>De:</strong> ${name} (${email})</p>
        <div style="background:#f7f7f9;border-left:3px solid #1A7FD4;padding:14px;margin:16px 0;border-radius:4px">
          <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;color:#555">${message}</pre>
        </div>
        <p style="color:#bbb;font-size:12px">Enviado em ${new Date().toLocaleString('pt-PT')}</p>
      </div>`
    })
    res.json({ message: 'Feedback enviado!' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao enviar feedback' })
  }
})

router.post('/:artistUsername', optionalAuth, sendContact);

module.exports = router;
