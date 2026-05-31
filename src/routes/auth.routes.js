// routes/auth.routes.js
const express = require('express');
const router = express.Router();
const { register, verifyEmail, login, me, forgotPassword, resetPassword } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', register);
router.post('/login', login);
router.get('/verify-email/:token', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.get('/me', authenticate, me);

module.exports = router;

// Atualizar nome do utilizador
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' })
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    await prisma.user.update({ where: { id: req.user.id }, data: { name } })
    res.json({ message: 'Perfil atualizado' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' })
  }
})

// Preferências de notificação
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { notifyOnMessage: true, notifyOnFavorite: true }
    })
    res.json(user)
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
})

router.put('/notifications', authenticate, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const { notifyOnMessage, notifyOnFavorite } = req.body
    await prisma.user.update({
      where: { id: req.user.id },
      data: { notifyOnMessage, notifyOnFavorite }
    })
    res.json({ message: 'Preferências atualizadas' })
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
})

// Doação — enviar instruções por email
router.post('/donation', async (req, res) => {
  try {
    const { name, email, amount, method, message } = req.body
    if (!name || !email || !amount || !method) return res.status(400).json({ error: 'Campos obrigatórios' })
    const { sendEmail } = require('../utils/email')
    const PAYMENT_INFO = {
      mbway: { label: 'MB Way', instructions: 'Envia o pagamento para o número +351 914 178 910 via MB Way.' },
      paypal: { label: 'PayPal', instructions: 'Envia o pagamento para nauuart@gmail.com via PayPal ou acede a https://paypal.me/nauuart' },
      transferencia: { label: 'Transferência Bancária', instructions: 'Faz a transferência para:\nIBAN: PT50 0023 0000 4572 3100 1039 4\nTitular: Nelson Gomes\nReferência: nauu.art doação' }
    }
    const info = PAYMENT_INFO[method]
    // Email ao doador
    await sendEmail({
      to: email,
      subject: `nauu.art — Instruções de pagamento (€${amount} via ${info.label})`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:40px 0">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
          <div style="background:#1A7FD4;padding:28px 36px;text-align:center">
            <img src="https://nauu.art/uploads/logo-email.png" alt="nauu.art" width="120" style="display:block;margin:0 auto" />
          </div>
          <div style="padding:36px">
            <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 16px">Obrigado, ${name}! 💙</h2>
            <p style="color:#555;font-size:15px;line-height:1.7">Recebemos o teu pedido de doação de <strong>€${amount}</strong> via <strong>${info.label}</strong>.</p>
            <div style="background:#f7f9fc;border-left:3px solid #1A7FD4;padding:16px;border-radius:4px;margin:20px 0">
              <p style="font-weight:700;color:#111;margin:0 0 8px">Instruções de pagamento:</p>
              <p style="color:#555;white-space:pre-line;margin:0">${info.instructions}</p>
            </div>
            <p style="color:#555;font-size:14px">Após recebermos o pagamento, enviaremos uma confirmação. O teu apoio faz a diferença!</p>
          </div>
          <div style="padding:16px;text-align:center;font-size:12px;color:#aaa">© ${new Date().getFullYear()} nauu.art</div>
        </div>
      </body></html>`
    })
    // Notificar admin
    await sendEmail({
      to: process.env.SMTP_USER,
      subject: `nauu.art — Nova doação de ${name}: €${amount} via ${info.label}`,
      html: `<p><strong>${name}</strong> (${email}) quer fazer uma doação de <strong>€${amount}</strong> via <strong>${info.label}</strong>.</p>${message ? `<p>Mensagem: ${message}</p>` : ''}`
    })
    res.json({ message: 'Instruções enviadas!' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao processar doação' })
  }
})

// Newsletter subscribe
router.post('/newsletter', async (req, res) => {
  try {
    const { email, name } = req.body
    if (!email) return res.status(400).json({ error: 'Email obrigatório' })
    const { sendEmail } = require('../utils/email')
    // Notificar admin
    await sendEmail({
      to: process.env.SMTP_USER,
      subject: `nauu.art — Nova subscrição newsletter: ${email}`,
      html: `<p>Nova subscrição newsletter:</p><p><strong>${name || 'Sem nome'}</strong> — ${email}</p>`
    })
    // Confirmar ao utilizador
    await sendEmail({
      to: email,
      subject: 'nauu.art — Subscrito com sucesso!',
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:40px 0">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
          <div style="background:#1A7FD4;padding:28px 36px;text-align:center">
            <img src="https://nauu.art/uploads/logo-email.png" alt="nauu.art" width="120" style="display:block;margin:0 auto" />
          </div>
          <div style="padding:36px">
            <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 16px">Subscrito com sucesso! 🎨</h2>
            <p style="color:#555;font-size:15px;line-height:1.7">Olá${name ? `, ${name}` : ''}! Vais começar a receber as nossas novidades — novos artistas, obras em destaque e muito mais.</p>
          </div>
          <div style="padding:16px;text-align:center;font-size:12px;color:#aaa">© ${new Date().getFullYear()} nauu.art</div>
        </div>
      </body></html>`
    })
    res.json({ message: 'Subscrito com sucesso!' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao subscrever' })
  }
})

// Mudar password (utilizador autenticado)
router.get('/check-username', async (req, res) => {
  try {
    const { username } = req.query
    if (!username || username.length < 3) return res.status(400).json({ error: 'Username inválido' })
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const userExists = await prisma.user.findUnique({ where: { username } })
    const artistExists = await prisma.artistProfile.findUnique({ where: { username } })
    if (userExists || artistExists) return res.status(409).json({ error: 'Username já em uso' })
    res.json({ available: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.put('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Preenche todos os campos' })
    if (newPassword.length < 8) return res.status(400).json({ error: 'A nova password deve ter pelo menos 8 caracteres' })
    const { PrismaClient } = require('@prisma/client')
    const bcrypt = require('bcryptjs')
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) return res.status(400).json({ error: 'Password atual incorreta' })
    const hash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: hash } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro ao mudar password' }) }
})

// Apagar conta
router.delete('/account', authenticate, async (req, res) => {
  try {
    const { password } = req.body
    if (!password) return res.status(400).json({ error: 'Confirma com a tua password' })
    const { PrismaClient } = require('@prisma/client')
    const bcrypt = require('bcryptjs')
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return res.status(400).json({ error: 'Password incorreta' })
    await prisma.user.delete({ where: { id: req.user.id } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro ao apagar conta' }) }
})
