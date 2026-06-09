const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
const JSZip = require('jszip')

const prisma = new PrismaClient()

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
// Gera ficheiro USDZ com vertical plane anchoring para iOS AR Quick Look
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

    // Imagem está em /var/www/nauu/uploads/artworks/xxx.webp
    // AR Quick Look não suporta WebP → converter para JPEG
    const imgRelPath = image.imageUrl.startsWith('/uploads/')
      ? image.imageUrl.slice('/uploads/'.length)
      : image.imageUrl
    const imgPath = path.join('/var/www/nauu/uploads', imgRelPath)

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ error: 'Ficheiro de imagem não encontrado' })
    }

    const jpgBuffer = await sharp(imgPath).jpeg({ quality: 90 }).toBuffer()

    const wM = dims.w / 100
    const hM = dims.h / 100
    const hw = (wM / 2).toFixed(4)
    const hh = (hM / 2).toFixed(4)
    const fw = (wM / 2 + 0.03).toFixed(4)
    const fh = (hM / 2 + 0.03).toFixed(4)

    // USDA com vertical plane anchoring (cola à parede no iOS AR Quick Look)
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
        float3[] extent = [(${-fw}, ${-fh}, -0.003), (${fw}, ${fh}, -0.003)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        normal3f[] normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)] (
            interpolation = "faceVarying"
        )
        point3f[] points = [(${-fw}, ${-fh}, -0.003), (${fw}, ${-fh}, -0.003), (${fw}, ${fh}, -0.003), (${-fw}, ${fh}, -0.003)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (1, 1), (0, 1)] (
            interpolation = "faceVarying"
        )
        int[] primvars:st:indices = [0, 1, 2, 3]
        rel material:binding = </Root/Materials/FrameMat>
    }

    def Mesh "Artwork"
    {
        float3[] extent = [(${-hw}, ${-hh}, 0), (${hw}, ${hh}, 0)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        normal3f[] normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1)] (
            interpolation = "faceVarying"
        )
        point3f[] points = [(${-hw}, ${-hh}, 0), (${hw}, ${-hh}, 0), (${hw}, ${hh}, 0), (${-hw}, ${hh}, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (1, 1), (0, 1)] (
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
                float inputs:roughness = 1
                float inputs:metallic = 0
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
                float inputs:metallic = 0
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

    const zip = new JSZip()
    zip.file('artwork.usda', usda)
    zip.file('artwork.jpg', jpgBuffer)

    const usdz = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })

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
