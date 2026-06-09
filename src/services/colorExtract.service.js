const sharp = require('sharp')
const fs = require('fs')

function quantize(v) { return Math.min(224, Math.round(v / 32) * 32) }

function hexToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h, s, l = (max + min) / 2
  if (max === min) { h = s = 0 } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return [h * 360, s * 100, l * 100]
}

function rgbToBucket(r, g, b) {
  const [h, s, l] = hexToHsl(r, g, b)
  if (l > 80 && s < 20) return 'branco'
  if (l < 15) return 'preto'
  if (s < 20) return 'cinzento'
  if (h < 15 || h >= 345) return 'vermelho'
  if (h < 45) return 'laranja'
  if (h < 75) return 'amarelo'
  if (h < 165) return 'verde'
  if (h < 255) return 'azul'
  return 'roxo'
}

async function extractColors(imgPath, maxColors = 6) {
  if (!fs.existsSync(imgPath)) return { colors: [], colorBuckets: [] }
  try {
    const { data } = await sharp(imgPath)
      .resize(80, 80, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const freq = {}
    for (let i = 0; i < data.length; i += 3) {
      const key = `${quantize(data[i])},${quantize(data[i+1])},${quantize(data[i+2])}`
      freq[key] = (freq[key] || 0) + 1
    }

    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
    const result = []
    for (const [key] of sorted) {
      if (result.length >= maxColors) break
      const [r, g, b] = key.split(',').map(Number)
      const tooClose = result.some(([pr, pg, pb]) =>
        Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 60
      )
      if (!tooClose) result.push([r, g, b])
    }

    const colors = result.map(([r, g, b]) =>
      '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    )
    const colorBuckets = [...new Set(result.map(([r, g, b]) => rgbToBucket(r, g, b)))]
    return { colors, colorBuckets }
  } catch {
    return { colors: [], colorBuckets: [] }
  }
}

module.exports = { extractColors }
