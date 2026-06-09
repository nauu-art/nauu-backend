const PDFDocument = require('pdfkit')
const QRCode = require('qrcode')
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://nauu.art'

async function generateCertificatePDF(order) {
  // order deve ter: id, buyer{name}, artwork{title,technique,dimensions,yearCreated,images,artist{artistName}}
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Certificado de Autenticidade — nauu.art' } })
  const buffers = []
  doc.on('data', b => buffers.push(b))

  const W = doc.page.width   // 595
  const H = doc.page.height  // 842
  const M = 40
  const certUrl = `${FRONTEND_URL}/certificado/${order.id}`

  // --- QR code ---
  const qrBuffer = await QRCode.toBuffer(certUrl, {
    width: 120, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#1a1a1a', light: '#ffffff' }
  })

  // --- Artwork image (WebP → JPEG) ---
  let artImgBuffer = null
  try {
    const imgUrl = order.artwork?.images?.[0]?.imageUrl
    if (imgUrl) {
      const rel = imgUrl.startsWith('/uploads/') ? imgUrl.slice('/uploads/'.length) : imgUrl
      const imgPath = path.join('/var/www/nauu/uploads', rel)
      if (fs.existsSync(imgPath)) {
        artImgBuffer = await sharp(imgPath)
          .resize(260, 260, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
      }
    }
  } catch {}

  // ── FUNDO ──
  doc.rect(0, 0, W, H).fill('#ffffff')

  // ── HEADER ──
  doc.rect(0, 0, W, 110).fill('#0f0f0f')

  // Texto "nauu.art" no header
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(30)
    .text('nauu.art', M, 32, { continued: false })

  // Subtítulo no header
  doc.fill('#aaaaaa').font('Helvetica').fontSize(10)
    .text('CERTIFICADO DE AUTENTICIDADE', M, 72, { characterSpacing: 3 })

  // Linha dourada separadora
  doc.rect(0, 110, W, 3).fill('#c9a84c')

  // ── CORPO ──
  const bodyY = 130

  // Imagem da obra
  const imgW = 200
  const imgH = 200
  const imgX = M
  const imgY = bodyY + 10

  if (artImgBuffer) {
    // Sombra subtil
    doc.rect(imgX + 3, imgY + 3, imgW, imgH).fill('#e0e0e0')
    doc.image(artImgBuffer, imgX, imgY, { width: imgW, height: imgH, cover: [imgW, imgH] })
    // Borda fina
    doc.rect(imgX, imgY, imgW, imgH).lineWidth(0.5).stroke('#cccccc')
  } else {
    doc.rect(imgX, imgY, imgW, imgH).fill('#f5f5f5').stroke('#e0e0e0')
    doc.fill('#bbbbbb').font('Helvetica').fontSize(10)
      .text('Imagem não disponível', imgX, imgY + 90, { width: imgW, align: 'center' })
  }

  // Detalhes da obra
  const detX = imgX + imgW + 30
  const detW = W - detX - M
  let y = bodyY + 10

  // Título
  doc.fill('#0f0f0f').font('Helvetica-Bold').fontSize(17)
    .text(order.artwork?.title || '—', detX, y, { width: detW })
  y += doc.heightOfString(order.artwork?.title || '—', { width: detW }) + 6

  // Artista
  doc.fill('#c9a84c').font('Helvetica-Bold').fontSize(10)
    .text((order.artwork?.artist?.artistName || '').toUpperCase(), detX, y, { width: detW })
  y += 22

  // Linha separadora
  doc.moveTo(detX, y).lineTo(detX + detW, y).lineWidth(0.5).stroke('#e0e0e0')
  y += 14

  // Campos da obra
  const field = (label, value) => {
    if (!value) return
    doc.fill('#999999').font('Helvetica').fontSize(8).text(label.toUpperCase(), detX, y)
    y += 12
    doc.fill('#1a1a1a').font('Helvetica').fontSize(11).text(value, detX, y, { width: detW })
    y += 18
  }

  if (order.artwork?.technique) field('Técnica', order.artwork.technique)
  if (order.artwork?.dimensions) field('Dimensões', order.artwork.dimensions)
  if (order.artwork?.yearCreated) field('Ano', String(order.artwork.yearCreated))

  y += 8
  doc.moveTo(detX, y).lineTo(detX + detW, y).lineWidth(0.5).stroke('#e0e0e0')
  y += 14

  // Info de aquisição
  const date = new Date(order.paidAt || order.createdAt)
    .toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })

  field('Adquirido por', order.buyer?.name || '—')
  field('Data de aquisição', date)

  // ── FAIXA INFERIOR ──
  const footerY = H - 130
  doc.rect(0, footerY, W, 130).fill('#f9f9f9')
  doc.rect(0, footerY, W, 1).fill('#e8e8e8')

  // ID do certificado
  doc.fill('#999999').font('Helvetica').fontSize(7).text('CERTIFICADO N.º', M, footerY + 14)
  doc.fill('#1a1a1a').font('Helvetica-Bold').fontSize(10).text(order.id.toUpperCase(), M, footerY + 26)

  // Texto legal
  doc.fill('#888888').font('Helvetica').fontSize(8).text(
    'Este documento certifica que a obra de arte identificada é um original único, criado manualmente pelo artista. A autenticidade desta obra foi verificada pela plataforma nauu.art no momento da transação. Este certificado pode ser verificado online através do QR code ou em nauu.art/certificado.',
    M, footerY + 46, { width: W - M * 2 - 130, lineGap: 2 }
  )

  // QR code no canto inferior direito
  doc.image(qrBuffer, W - M - 100, footerY + 10, { width: 100 })
  doc.fill('#aaaaaa').font('Helvetica').fontSize(7)
    .text('Verificar online', W - M - 100, footerY + 113, { width: 100, align: 'center' })

  // Linha dourada no fundo
  doc.rect(0, H - 4, W, 4).fill('#c9a84c')

  doc.end()
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))))
}

module.exports = { generateCertificatePDF }
