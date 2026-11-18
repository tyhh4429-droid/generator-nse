export const MAX_IMAGE_ART_ANCHORS = 8000
export const MAX_IMAGE_ART_GRID_SIZE = 1024

export type ImageArtForeground = 'dark' | 'light'

export type BinaryImageArt = {
    width: number
    height: number
    pixels: Uint8Array
    count: number
}

export type ImageArtRun = {
    column: number
    startRow: number
    endRow: number
}

const emptyImageArt = (): BinaryImageArt => ({
    width: 0,
    height: 0,
    pixels: new Uint8Array(),
    count: 0,
})

const isForeground = (
    data: Uint8ClampedArray,
    index: number,
    threshold: number,
    foreground: ImageArtForeground,
) => {
    if ((data[index + 3] ?? 0) < 16) return false

    const luminance =
        (data[index] ?? 0) * 0.2126 +
        (data[index + 1] ?? 0) * 0.7152 +
        (data[index + 2] ?? 0) * 0.0722
    return foreground === 'dark' ? luminance < threshold : luminance >= threshold
}

const getForegroundBounds = (
    image: ImageData,
    threshold: number,
    foreground: ImageArtForeground,
) => {
    let minX = image.width
    let minY = image.height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const index = (y * image.width + x) * 4
            if (!isForeground(image.data, index, threshold, foreground)) continue

            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x)
            maxY = Math.max(maxY, y)
        }
    }

    if (maxX < minX || maxY < minY) return

    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    }
}

export const rasterizeImageArt = (
    source: HTMLCanvasElement,
    threshold: number,
    foreground: ImageArtForeground,
    artWidth: number,
    anchorWidth: number,
): BinaryImageArt => {
    const sourceContext = source.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) return emptyImageArt()

    const sourceImage = sourceContext.getImageData(0, 0, source.width, source.height)
    const bounds = {
      x: 0,
      y: 0,
      width: source.width,
      height: source.height,
}

    let width = Math.min(MAX_IMAGE_ART_GRID_SIZE, Math.max(1, Math.floor(artWidth / anchorWidth)))
    let height = Math.max(1, Math.round((width * bounds.height) / bounds.width))
    if (height > MAX_IMAGE_ART_GRID_SIZE) {
        width = Math.max(1, Math.round((width * MAX_IMAGE_ART_GRID_SIZE) / height))
        height = MAX_IMAGE_ART_GRID_SIZE
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return emptyImageArt()

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, width, height)

    const image = context.getImageData(0, 0, width, height)
    const pixels = new Uint8Array(width * height)
    let count = 0

    for (let i = 0; i < pixels.length; i++) {
        if (!isForeground(image.data, i * 4, threshold, foreground)) continue

        pixels[i] = 1
        count++
    }

    return { width, height, pixels, count }
}

export const getVerticalImageArtRuns = (art: BinaryImageArt) => {
    const runs: ImageArtRun[] = []

    for (let column = 0; column < art.width; column++) {
        let startRow: number | undefined

        for (let row = 0; row <= art.height; row++) {
            const isFilled = row < art.height && art.pixels[row * art.width + column] === 1
            if (isFilled) {
                startRow ??= row
                continue
            }
            if (startRow === undefined) continue

            runs.push({ column, startRow, endRow: row - 1 })
            startRow = undefined
        }
    }

    return runs
}

export const paintImageArtPreview = (canvas: HTMLCanvasElement, art: BinaryImageArt) => {
    canvas.width = Math.max(1, art.width)
    canvas.height = Math.max(1, art.height)

    const context = canvas.getContext('2d')
    if (!context) return

    const image = context.createImageData(canvas.width, canvas.height)
    for (let i = 0; i < canvas.width * canvas.height; i++) {
        const foreground = art.pixels[i] === 1
        const offset = i * 4
        image.data[offset] = foreground ? 245 : 35
        image.data[offset + 1] = foreground ? 247 : 39
        image.data[offset + 2] = foreground ? 250 : 52
        image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
}
