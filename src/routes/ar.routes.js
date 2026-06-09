const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const prisma = new PrismaClient()

// CRC-32 para o ZIP (necessário para USDZ)
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = (crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0
  return (c ^ 0xFFFFFFFF) >>> 0
}

// Construtor USDZ com alinhamento obrigatório de 64 bytes por ficheiro
// (AR Quick Look faz memory-map e exige que cada file data esteja em múltiplo de 64)
function buildUSDZ(entries) {
  const ALIGN = 64
  const localParts = []
  const centralHeaders = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'ascii')
    const checksum = crc32(data)

    // Quantos bytes de padding no extra field para alinhar o data a 64 bytes?
    const headerBase = 30 + nameBytes.length
    const dataPos = offset + headerBase
    const alignPad = (ALIGN - (dataPos % ALIGN)) % ALIGN

    // Local File Header
    const lh = Buffer.alloc(headerBase + alignPad)
    lh.writeUInt32LE(0x04034B50, 0)          // signature
    lh.writeUInt16LE(20, 4)                   // version needed
    lh.writeUInt16LE(0, 6)                    // flags
    lh.writeUInt16LE(0, 8)                    // compression: STORE
    lh.writeUInt16LE(0, 10)                   // mod time
    lh.writeUInt16LE(0, 12)                   // mod date
    lh.writeUInt32LE(checksum, 14)            // CRC-32
    lh.writeUInt32LE(data.length, 18)         // compressed size
    lh.writeUInt32LE(data.length, 22)         // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26)    // filename length
    lh.writeUInt16LE(alignPad, 28)            // extra field length (padding)
    nameBytes.copy(lh, 30)
    // bytes 30+nameLen .. end são zero (Buffer.alloc)

    // Central Directory entry
    const cd = Buffer.alloc(46 + nameBytes.length)
    cd.writeUInt32LE(0x02014B50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(checksum, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt16LE(0, 30)                  // no extra
    cd.writeUInt16LE(0, 32)                  // no comment
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)             // offset of local header
    nameBytes.copy(cd, 46)

    localParts.push(lh, data)
    centralHeaders.push(cd)
    offset += lh.length + data.length
  }

  const cdSize = centralHeaders.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054B50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralHeaders, eocd])
}

function parseDimensions(str) {
  if (!str) return null
  const m = str.match(/(\d+(?:[.,]\d+)?)\s*[x×X]\s*(\d+(?:[.,]\d+)?)/i)
  if (!m) return null
  return {
    w: parseFloat(m[1].replace(',', '.')),
    h: parseFloat(m[2].replace(',', '.')),
  }
}

// GET /api/ar/usdz/:artworkId
router.get('/usdz/:artworkId', async (req, res) => {
  try {
    const artwork = await prisma.artwork.findUnique({
      where: { id: req.params.artworkId },
      include: { images: { where: { isPrimary: true }, take: 1 } },
    })

    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })

    const dims = parseDimensions(artwork.dimensions)
    if (!dims) return res.status(400).json({ error: 'Dimensões inválidas ou em falta' })

    const image = artwork.images[0]
    if (!image) return res.status(400).json({ error: 'Imagem não disponível' })

    // Converter WebP → JPEG (AR Quick Look não suporta WebP)
    const imgRelPath = image.imageUrl.startsWith('/uploads/')
      ? image.imageUrl.slice('/uploads/'.length)
      : image.imageUrl
    const imgPath = path.join('/var/www/nauu/uploads', imgRelPath)
    if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'Ficheiro de imagem não encontrado' })

    const jpgBuffer = await sharp(imgPath).jpeg({ quality: 90 }).toBuffer()

    const wM = dims.w / 100
    const hM = dims.h / 100
    const hw = (wM / 2).toFixed(4)
    const hh = (hM / 2).toFixed(4)
    const fw = (wM / 2 + 0.03).toFixed(4)
    const fh = (hM / 2 + 0.03).toFixed(4)

    // USDA com vertical plane anchoring para iOS AR Quick Look colar à parede
    const usda = `#usda 1.0
(
    defaultPrim = "Root"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Root" (
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{
    token preliminary:anchoring:type = "plane"
    token preliminary:planeAnchoring:alignment = "vertical"

    def Mesh "Frame"
    {
        float3[] extent = [(${-fw}, ${-fh}, 0.0), (${fw}, ${fh}, 0.0)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        normal3f[] normals = [(0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0)] (
            interpolation = "faceVarying"
        )
        point3f[] points = [(${-fw}, ${-fh}, 0.0), (${fw}, ${-fh}, 0.0), (${fw}, ${fh}, 0.0), (${-fw}, ${fh}, 0.0)]
        texCoord2f[] primvars:st = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] (
            interpolation = "faceVarying"
        )
        int[] primvars:st:indices = [0, 1, 2, 3]
        rel material:binding = </Root/Materials/FrameMat>
    }

    def Mesh "Artwork"
    {
        float3[] extent = [(${-hw}, ${-hh}, 0.001), (${hw}, ${hh}, 0.001)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        normal3f[] normals = [(0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0)] (
            interpolation = "faceVarying"
        )
        point3f[] points = [(${-hw}, ${-hh}, 0.001), (${hw}, ${-hh}, 0.001), (${hw}, ${hh}, 0.001), (${-hw}, ${hh}, 0.001)]
        texCoord2f[] primvars:st = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] (
            interpolation = "faceVarying"
        )
        int[] primvars:st:indices = [0, 1, 2, 3]
        rel material:binding = </Root/Materials/ArtworkMat>
    }

    def Scope "Materials"
    {
        def Material "FrameMat"
        {
            token outputs:surface.connect = </Root/Materials/FrameMat/PBR.outputs:surface>
            def Shader "PBR"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.1, 0.1, 0.1)
                float inputs:roughness = 1.0
                float inputs:metallic = 0.0
                token outputs:surface
            }
        }

        def Material "ArtworkMat"
        {
            token outputs:surface.connect = </Root/Materials/ArtworkMat/PBR.outputs:surface>
            def Shader "PBR"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Root/Materials/ArtworkMat/Tex.outputs:rgb>
                float inputs:roughness = 0.8
                float inputs:metallic = 0.0
                token outputs:surface
            }
            def Shader "Tex"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @artwork.jpg@
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "clamp"
                float3 outputs:rgb
            }
        }
    }
}
`

    const usdaBuffer = Buffer.from(usda, 'utf8')
    const usdz = buildUSDZ([
      { name: 'artwork.usda', data: usdaBuffer },
      { name: 'artwork.jpg', data: jpgBuffer },
    ])

    res.setHeader('Content-Type', 'model/vnd.usdz+zip')
    res.setHeader('Content-Disposition', `inline; filename="${artwork.id}.usdz"`)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(usdz)
  } catch (err) {
    console.error('[AR USDZ]', err)
    res.status(500).json({ error: 'Erro a gerar USDZ' })
  }
})

module.exports = router
