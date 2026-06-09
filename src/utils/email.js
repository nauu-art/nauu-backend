const nodemailer = require('nodemailer')

const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  family: 4,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }
})

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 285.42 102.94" width="120" height="43">
  <path fill="#ffffff" d="M33.13,0C14.83,0,0,14.83,0,33.13v39.92h18.66v-39.59c0-7.84,6.36-14.2,14.2-14.2c7.84,0,14.2,6.36,14.2,14.2v39.59h19.2V33.13C66.26,14.83,51.43,0,33.13,0Z"/>
  <path fill="#ffffff" d="M106.18,0C87.88,0,72.05,14.83,72.05,33.13v39.92h18.66v-39.59c0-7.84,6.36-14.2,14.2-14.2c7.84,0,14.2,6.36,14.2,14.2v39.59h19.2V33.13C139.31,14.83,124.48,0,106.18,0Z"/>
  <path fill="#ffffff" d="M252.29,102.94c18.3,0,33.13-14.83,33.13-33.13V29.89h-18.66v39.59c0,7.84-6.36,14.2-14.2,14.2c-7.84,0-14.2-6.36-14.2-14.2V29.89h-19.2v39.92c0,18.3,14.83,33.13,33.13,33.13Z"/>
  <path fill="#ffffff" d="M179.24,102.94c18.3,0,33.13-14.83,33.13-33.13V29.89h-18.66v39.59c0,7.84-6.36,14.2-14.2,14.2c-7.84,0-14.2-6.36-14.2-14.2V29.89h-19.2v39.92c0,18.3,14.83,33.13,33.13,33.13Z"/>
  <circle fill="#ffffff" cx="106.18" cy="49.54" r="9.45"/>
</svg>`

const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .wrapper { max-width: 560px; margin: 40px auto; }
    .header { background: #1A7FD4; padding: 28px 36px; border-radius: 12px 12px 0 0; text-align: left; }
    .body { background: #ffffff; padding: 36px; border-radius: 0 0 12px 12px; color: #333; font-size: 15px; line-height: 1.7; }
    .btn { display: inline-block; margin: 24px 0 8px; padding: 14px 32px; background: #1A7FD4; color: #fff !important; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .footer { padding: 20px 0; text-align: center; font-size: 12px; color: #aaa; }
    h2 { font-size: 22px; font-weight: 800; color: #111; margin: 0 0 16px; letter-spacing: -0.02em; }
    p { margin: 0 0 14px; color: #555; }
    .highlight { background: #f7f9fc; border-left: 3px solid #1A7FD4; padding: 14px 18px; border-radius: 4px; margin: 18px 0; font-style: italic; color: #444; }
    .meta { font-size: 13px; color: #888; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header" style="text-align:center;">
      <img src="https://nauu.art/uploads/logo-email.png" alt="nauu.art" width="120" style="display:block;margin:0 auto;" />
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} nauu.art — Arte original, do artista para ti<br>
      <a href="https://nauu.art" style="color:#1A7FD4;text-decoration:none;">nauu.art</a>
    </div>
  </div>
</body>
</html>`

const sendEmail = async ({ to, subject, html, attachments }) => {
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    ...(attachments && { attachments }),
  })
}

const sendVerificationEmail = async (email, name, token) => {
  const url = `${process.env.FRONTEND_URL}/verify-email/${token}`
  await sendEmail({
    to: email,
    subject: 'nauu.art — Confirma o teu email',
    html: baseTemplate(`
      <h2>Olá, ${name}! 👋</h2>
      <p>Obrigado por te juntares ao nauu.art. Clica no botão abaixo para confirmar o teu email e ativar a conta.</p>
      <a href="${url}" class="btn">Confirmar email</a>
      <p class="meta">O link expira em 24 horas. Se não criaste uma conta, ignora este email.</p>
    `),
  })
}

const sendPasswordResetEmail = async (email, name, token) => {
  const url = `${process.env.FRONTEND_URL}/reset-password/${token}`
  await sendEmail({
    to: email,
    subject: 'nauu.art — Recuperar password',
    html: baseTemplate(`
      <h2>Recuperar password</h2>
      <p>Olá, ${name}! Recebemos um pedido para redefinir a tua password.</p>
      <a href="${url}" class="btn">Redefinir password</a>
      <p class="meta">O link expira em 1 hora. Se não pediste isto, ignora este email.</p>
    `),
  })
}

const sendContactNotification = async (artistEmail, artistName, { senderName, senderEmail, message, artworkTitle }) => {
  await sendEmail({
    to: artistEmail,
    subject: `nauu.art — Nova mensagem de ${senderName}`,
    html: baseTemplate(`
      <h2>Nova mensagem! 📩</h2>
      <p>Olá, <strong>${artistName}</strong>! Tens uma nova mensagem no nauu.art.</p>
      ${artworkTitle ? `<p><strong>Obra:</strong> ${artworkTitle}</p>` : ''}
      <p><strong>De:</strong> ${senderName} (${senderEmail})</p>
      <div class="highlight">"${message}"</div>
      <p>Responde diretamente para <a href="mailto:${senderEmail}" style="color:#1A7FD4">${senderEmail}</a></p>
    `),
  })
}

const sendContactConfirmation = async (senderEmail, senderName, artistName) => {
  await sendEmail({
    to: senderEmail,
    subject: `nauu.art — Mensagem enviada a ${artistName}`,
    html: baseTemplate(`
      <h2>Mensagem enviada! ✅</h2>
      <p>Olá, ${senderName}! A tua mensagem foi enviada a <strong>${artistName}</strong>.</p>
      <p>O artista irá responder diretamente para o teu email. Enquanto aguardas, continua a explorar obras no nauu.art.</p>
      <a href="${process.env.FRONTEND_URL}/explore" class="btn">Explorar obras</a>
    `),
  })
}

const sendWelcomeArtist = async (email, name) => {
  await sendEmail({
    to: email,
    subject: 'nauu.art — Bem-vindo, artista! 🎨',
    html: baseTemplate(`
      <h2>Bem-vindo ao nauu.art, ${name}! 🎨</h2>
      <p>A tua conta foi ativada. Agora podes completar o teu perfil e publicar as tuas primeiras obras.</p>
      <p>Começa por:</p>
      <p>→ Adicionar uma foto de perfil<br>→ Escrever a tua bio<br>→ Publicar a tua primeira obra</p>
      <a href="${process.env.FRONTEND_URL}/dashboard" class="btn">Ir para o dashboard</a>
    `),
  })
}

const sendWelcomeUser = async (email, name) => {
  await sendEmail({
    to: email,
    subject: 'nauu.art — Bem-vindo! 👋',
    html: baseTemplate(`
      <h2>Bem-vindo ao nauu.art, ${name}!</h2>
      <p>A tua conta foi ativada. Começa a explorar obras de artistas portugueses e internacionais.</p>
      <a href="${process.env.FRONTEND_URL}/explore" class="btn">Explorar obras</a>
    `),
  })
}

const sendEmail2 = async ({ to, subject, html }) => {
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  })
}


const sendOrderConfirmationBuyer = async (email, { buyerName, artworkTitle, artistName, price, address, orderId }) => {
  const addressStr = address ? `${address.street}, ${address.city}, ${address.postalCode}, ${address.country}` : 'Não fornecida'
  await sendEmail({
    to: email,
    subject: `nauu.art — Confirmação de compra: ${artworkTitle}`,
    html: baseTemplate(`
      <h2>Compra confirmada! 🎉</h2>
      <p>Olá, <strong>${buyerName}</strong>! O teu pagamento foi processado com sucesso.</p>
      <div class="highlight">
        <strong>${artworkTitle}</strong><br>
        por ${artistName}<br>
        <strong>€ ${price}</strong>
      </div>
      <p><strong>Morada de entrega:</strong><br>${addressStr}</p>
      <p>O artista irá contactar-te em breve para combinar a entrega da obra. Podes acompanhar a tua encomenda no nauu.art.</p>
      <a href="${process.env.FRONTEND_URL}/account/orders" class="btn">Ver as minhas encomendas</a>
      <p class="meta">Referência da encomenda: ${orderId}</p>
    `),
  })
}

const sendOrderNotificationArtist = async (email, { artistName, buyerName, buyerEmail, artworkTitle, price, address, orderId }) => {
  const addressStr = address ? `
    <p><strong>Morada de entrega:</strong></p>
    <div class="highlight">
      ${address.name || buyerName}<br>
      ${address.street}<br>
      ${address.postalCode} ${address.city}<br>
      ${address.country}<br>
      ${address.phone ? `Tel: ${address.phone}` : ''}
    </div>
  ` : ''
  await sendEmail({
    to: email,
    subject: `nauu.art — Nova venda: ${artworkTitle}`,
    html: baseTemplate(`
      <h2>Vendeste uma obra! 🎨</h2>
      <p>Olá, <strong>${artistName}</strong>! Tens uma nova venda no nauu.art.</p>
      <div class="highlight">
        <strong>${artworkTitle}</strong><br>
        Comprador: ${buyerName} (${buyerEmail})<br>
        <strong>€ ${price}</strong>
      </div>
      ${addressStr}
      <p>O pagamento está a ser processado pela Stripe. O valor será transferido para a tua conta nos próximos dias.</p>
      <a href="${process.env.FRONTEND_URL}/dashboard" class="btn">Ver o dashboard</a>
      <p class="meta">Referência da encomenda: ${orderId}</p>
    `),
  })
}

module.exports = {
  sendEmail,
  baseTemplate,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendContactNotification,
  sendContactConfirmation,
  sendWelcomeArtist,
  sendWelcomeUser,
  sendOrderConfirmationBuyer,
  sendOrderNotificationArtist,
}
