import type { Font, PathCommand } from 'opentype.js'
import type { StrokePoint } from '.'

export type CustomFontMode = 'outline' | 'centerline' | 'filled'

export type CustomStrokeFont = {
    key: string
    name: string
    font: Font
}

const customFonts = new Map<string, CustomStrokeFont>()

const fontSize = 28
const lineHeight = 32
const rasterScale = 2
const rasterPadding = 3
const simplifyTolerance = 0.45

const neighbors = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
] as const

export const loadCustomStrokeFont = async (file: File): Promise<CustomStrokeFont> => {
    const { parse } = await import('opentype.js')
    const buffer = await file.arrayBuffer()
    const key = await toBufferKey(buffer)
    const cached = customFonts.get(key)
    if (cached) return cached

    const font = parse(buffer)
    if (!font.supported || !Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
        throw new Error('Unsupported font.')
    }

    const customFont = {
        key,
        name: getFontName(font) || file.name.replace(/\.[^.]+$/, ''),
        font,
    }
    customFonts.set(key, customFont)
    return customFont
}

export const getCustomStrokeFont = (key: string | undefined) =>
    key ? customFonts.get(key) : undefined

export const customFontToPaths = (
    font: Font,
    text: string,
    offsetY: number,
    mode: CustomFontMode,
) => {
    switch (mode) {
        case 'outline':
            return {
                ...customFontToOutlinePaths(font, text, offsetY),
                strokeSizes: undefined,
            }

        case 'filled':
            return customFontToFilledPaths(font, text, offsetY)

        default:
            return {
                ...customFontToCenterlinePaths(font, text, offsetY),
                strokeSizes: undefined,
            }
    }
}

const customFontToOutlinePaths = (font: Font, text: string, offsetY: number) => {
    const paths: StrokePoint[][] = []

    font.forEachGlyph(text, 0, 0, fontSize, { kerning: true }, (glyph, x) => {
        paths.push(...commandsToPaths(glyph.getPath(x, 0, fontSize).commands, offsetY))
    })

    return {
        width: font.getAdvanceWidth(text, fontSize, { kerning: true }),
        paths,
    }
}

const customFontToFilledPaths = (
    font: Font,
    text: string,
    offsetY: number,
) => {
    const width = font.getAdvanceWidth(text, fontSize, { kerning: true })

    if (!text || width <= 0) {
        return {
            width: Math.max(0, width),
            paths: [] as StrokePoint[][],
            strokeSizes: [] as number[][],
        }
    }

    const ascender = (font.ascender / font.unitsPerEm) * fontSize
    const descender = (-font.descender / font.unitsPerEm) * fontSize
    const canvas = document.createElement('canvas')

    canvas.width = Math.max(
        1,
        Math.ceil((width + rasterPadding * 2) * rasterScale),
    )
    canvas.height = Math.max(
        1,
        Math.ceil((ascender + descender + rasterPadding * 2) * rasterScale),
    )

    const context = canvas.getContext('2d', {
        willReadFrequently: true,
    })

    if (!context) throw new Error('Canvas is unavailable.')

    const baseline = (rasterPadding + ascender) * rasterScale

    context.clearRect(0, 0, canvas.width, canvas.height)

    font.draw(
        context,
        text,
        rasterPadding * rasterScale,
        baseline,
        fontSize * rasterScale,
        { kerning: true },
    )

    const image = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
    )

    const bitmap = new Uint8Array(canvas.width * canvas.height)

    for (let i = 0; i < bitmap.length; i++) {
        bitmap[i] = (image.data[i * 4 + 3] ?? 0) >= 128 ? 1 : 0
    }

    // Calculate the distance from each pixel inside the character to the character's border.
    const distance = new Float32Array(bitmap.length)
    const diagonal = Math.SQRT2
    const infinity = canvas.width + canvas.height

    for (let i = 0; i < bitmap.length; i++) {
        distance[i] = bitmap[i] ? infinity : 0
    }

    const indexOf = (x: number, y: number) =>
        x + y * canvas.width

    // Scan from top to bottom.
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const index = indexOf(x, y)
            if (!bitmap[index]) continue

            let value = distance[index] ?? infinity

            if (x > 0) {
                value = Math.min(value, (distance[index - 1] ?? infinity) + 1)
            }

            if (y > 0) {
                value = Math.min(value, (distance[index - canvas.width] ?? infinity) + 1)

                if (x > 0) {
                    value = Math.min(
                        value,
                        (distance[index - canvas.width - 1] ?? infinity) + diagonal,
                    )
                }

                if (x < canvas.width - 1) {
                    value = Math.min(
                        value,
                        (distance[index - canvas.width + 1] ?? infinity) + diagonal,
                    )
                }
            }

            distance[index] = value
        }
    }

    // The scan proceeds from bottom to top.
    for (let y = canvas.height - 1; y >= 0; y--) {
        for (let x = canvas.width - 1; x >= 0; x--) {
            const index = indexOf(x, y)
            if (!bitmap[index]) continue

            let value = distance[index] ?? infinity

            if (x < canvas.width - 1) {
                value = Math.min(value, (distance[index + 1] ?? infinity) + 1)
            }

            if (y < canvas.height - 1) {
                value = Math.min(value, (distance[index + canvas.width] ?? infinity) + 1)

                if (x > 0) {
                    value = Math.min(
                        value,
                        (distance[index + canvas.width - 1] ?? infinity) + diagonal,
                    )
                }

                if (x < canvas.width - 1) {
                    value = Math.min(
                        value,
                        (distance[index + canvas.width + 1] ?? infinity) + diagonal,
                    )
                }
            }

            distance[index] = value
        }
    }

    // Create the skeleton and trace every detail.
    thinBitmap(bitmap, canvas.width, canvas.height)

    const skeletonPaths = traceSkeleton(
        bitmap,
        canvas.width,
        canvas.height,
    )

    const paths: StrokePoint[][] = []
    const strokeSizes: number[][] = []

    for (const skeleton of skeletonPaths) {
        const points: StrokePoint[] = []
        const sizes: number[] = []

        for (const [x, y] of skeleton) {
            const index = indexOf(
                Math.round(x),
                Math.round(y),
            )

            const radius = distance[index] ?? 0

            points.push([
                (x + 0.5) / rasterScale - rasterPadding,
                offsetY + (baseline - (y + 0.5)) / rasterScale,
            ])

            // Estimated diameter, converted from pixels to font units.
            sizes.push(Math.max(0.5, (radius * 2) / rasterScale))
        }

        if (points.length < 2) continue

        const simplified = simplifyPathWithSizes(
            points,
            sizes,
            simplifyTolerance,
            0.5,
        )

        if (simplified.points.length < 2) continue

        paths.push(simplified.points)
        strokeSizes.push(simplified.sizes)
    }

    return { width, paths, strokeSizes }
}

const simplifyPathWithSizes = (
    points: StrokePoint[],
    sizes: number[],
    tolerance: number,
    sizeTolerance: number,
) => {
    if (points.length <= 2) {
        return { points, sizes }
    }

    const keep = new Uint8Array(points.length)
    keep[0] = 1
    keep[points.length - 1] = 1

    const simplify = (start: number, end: number) => {
        const first = points[start]
        const last = points[end]

        if (!first || !last) return

        let maxError = 0
        let maxIndex = -1

        for (let i = start + 1; i < end; i++) {
            const point = points[i]
            if (!point) continue

            const geometryError = pointToSegmentDistance(
                point,
                first,
                last,
            )

            const dx = last[0] - first[0]
            const dy = last[1] - first[1]
            const lengthSquared = dx * dx + dy * dy

            const t = lengthSquared > 0
                ? Math.max(
                      0,
                      Math.min(
                          1,
                          ((point[0] - first[0]) * dx +
                              (point[1] - first[1]) * dy) /
                              lengthSquared,
                      ),
                  )
                : 0

            const expectedSize =
                (sizes[start] ?? 0) * (1 - t) +
                (sizes[end] ?? 0) * t

            const sizeError = Math.abs(
                (sizes[i] ?? 0) - expectedSize,
            )

            const error = Math.max(
                geometryError / tolerance,
                sizeError / sizeTolerance,
            )

            if (error > maxError) {
                maxError = error
                maxIndex = i
            }
        }

        if (maxIndex !== -1 && maxError > 1) {
            keep[maxIndex] = 1
            simplify(start, maxIndex)
            simplify(maxIndex, end)
        }
    }

    simplify(0, points.length - 1)

    const resultPoints: StrokePoint[] = []
    const resultSizes: number[] = []

    for (let i = 0; i < points.length; i++) {
        if (!keep[i]) continue

        resultPoints.push(points[i]!)
        resultSizes.push(sizes[i] ?? 0.5)
    }

    return {
        points: resultPoints,
        sizes: resultSizes,
    }
}

const customFontToCenterlinePaths = (font: Font, text: string, offsetY: number) => {
    const width = font.getAdvanceWidth(text, fontSize, { kerning: true })
    if (!text || width <= 0) return { width: Math.max(0, width), paths: [] }

    const ascender = (font.ascender / font.unitsPerEm) * fontSize
    const descender = (-font.descender / font.unitsPerEm) * fontSize
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil((width + rasterPadding * 2) * rasterScale))
    canvas.height = Math.max(1, Math.ceil((ascender + descender + rasterPadding * 2) * rasterScale))

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas is unavailable.')

    const baseline = (rasterPadding + ascender) * rasterScale
    context.clearRect(0, 0, canvas.width, canvas.height)
    font.draw(context, text, rasterPadding * rasterScale, baseline, fontSize * rasterScale, {
        kerning: true,
    })

    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const bitmap = new Uint8Array(canvas.width * canvas.height)
    for (let i = 0; i < bitmap.length; i++) {
        bitmap[i] = (image.data[i * 4 + 3] ?? 0) >= 128 ? 1 : 0
    }

    thinBitmap(bitmap, canvas.width, canvas.height)
    const paths = traceSkeleton(bitmap, canvas.width, canvas.height).flatMap((path) => {
        const points = simplifyPath(
            path.map((index): StrokePoint => {
                const x = ((index % canvas.width) + 0.5) / rasterScale - rasterPadding
                const y =
                    offsetY + (baseline - (Math.floor(index / canvas.width) + 0.5)) / rasterScale
                return [x, y]
            }),
            simplifyTolerance,
        )
        return points.length >= 2 ? [points] : []
    })

    return { width, paths }
}

export const customFontLineHeight = lineHeight

const getFontName = (font: Font) => {
    const fullName = font.names.fullName
    return fullName.en ?? Object.values(fullName)[0] ?? ''
}

const toBufferKey = async (buffer: ArrayBuffer) => {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
        '',
    )
}

type Point = {
    x: number
    y: number
}

const commandsToPaths = (commands: PathCommand[], offsetY: number) => {
    const paths: StrokePoint[][] = []
    let path: StrokePoint[] = []
    let current: Point | undefined
    let start: Point | undefined

    const addPoint = ({ x, y }: Point) => {
        const next = [x, offsetY - y] as const
        const previous = path.at(-1)
        if (previous?.[0] === next[0] && previous[1] === next[1]) return
        path.push(next)
    }
    const flush = () => {
        if (path.length >= 2) paths.push(path)
        path = []
    }

    for (const command of commands) {
        switch (command.type) {
            case 'M': {
                flush()
                current = { x: command.x, y: command.y }
                start = current
                addPoint(current)
                break
            }
            case 'L': {
                current = { x: command.x, y: command.y }
                addPoint(current)
                break
            }
            case 'Q': {
                if (!current) break
                const control = { x: command.x1, y: command.y1 }
                const end = { x: command.x, y: command.y }
                const segments = getCurveSegments([current, control, end])
                for (let i = 1; i <= segments; i++) {
                    addPoint(quadraticPoint(current, control, end, i / segments))
                }
                current = end
                break
            }
            case 'C': {
                if (!current) break
                const control1 = { x: command.x1, y: command.y1 }
                const control2 = { x: command.x2, y: command.y2 }
                const end = { x: command.x, y: command.y }
                const segments = getCurveSegments([current, control1, control2, end])
                for (let i = 1; i <= segments; i++) {
                    addPoint(cubicPoint(current, control1, control2, end, i / segments))
                }
                current = end
                break
            }
            case 'Z': {
                if (start) addPoint(start)
                current = start
                flush()
                start = undefined
                break
            }
        }
    }

    flush()
    return paths
}

const getCurveSegments = (points: Point[]) => {
    let length = 0
    for (let i = 1; i < points.length; i++) {
        const previous = points[i - 1]
        const point = points[i]
        if (!previous || !point) continue
        length += Math.hypot(point.x - previous.x, point.y - previous.y)
    }
    return Math.max(2, Math.min(16, Math.ceil(length / 2)))
}

const quadraticPoint = (start: Point, control: Point, end: Point, t: number): Point => {
    const inverse = 1 - t
    return {
        x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
    }
}

const cubicPoint = (
    start: Point,
    control1: Point,
    control2: Point,
    end: Point,
    t: number,
): Point => {
    const inverse = 1 - t
    return {
        x:
            inverse ** 3 * start.x +
            3 * inverse * inverse * t * control1.x +
            3 * inverse * t * t * control2.x +
            t ** 3 * end.x,
        y:
            inverse ** 3 * start.y +
            3 * inverse * inverse * t * control1.y +
            3 * inverse * t * t * control2.y +
            t ** 3 * end.y,
    }
}

const thinBitmap = (bitmap: Uint8Array, width: number, height: number) => {
    let changed = true

    while (changed) {
        changed = removeThinningPixels(bitmap, width, height, false)
        changed = removeThinningPixels(bitmap, width, height, true) || changed
    }
}

const removeThinningPixels = (
    bitmap: Uint8Array,
    width: number,
    height: number,
    secondPass: boolean,
) => {
    const remove: number[] = []

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const index = x + y * width
            if (!bitmap[index]) continue

            const values = neighbors.map(
                ([offsetX, offsetY]) => bitmap[index + offsetX + offsetY * width] ?? 0,
            )
            const count = values.reduce((sum, value) => sum + value, 0)
            if (count < 2 || count > 6) continue

            let transitions = 0
            for (let i = 0; i < values.length; i++) {
                if (!values[i] && values[(i + 1) % values.length]) transitions++
            }
            if (transitions !== 1) continue

            const north = values[0] ?? 0
            const east = values[2] ?? 0
            const south = values[4] ?? 0
            const west = values[6] ?? 0
            const firstCondition = secondPass
                ? north * east * west === 0
                : north * east * south === 0
            const secondCondition = secondPass
                ? north * south * west === 0
                : east * south * west === 0
            if (firstCondition && secondCondition) remove.push(index)
        }
    }

    for (const index of remove) bitmap[index] = 0
    return !!remove.length
}

const traceSkeleton = (bitmap: Uint8Array, width: number, height: number) => {
    const paths: number[][] = []
    const edges = new Set<string>()
    const points: number[] = []

    for (let index = 0; index < bitmap.length; index++) {
        if (bitmap[index]) points.push(index)
    }

    const getNeighbors = (index: number) => {
        const x = index % width
        const y = Math.floor(index / width)
        return neighbors.flatMap(([offsetX, offsetY]) => {
            const nextX = x + offsetX
            const nextY = y + offsetY
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return []
            const next = nextX + nextY * width
            return bitmap[next] ? [next] : []
        })
    }
    const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

    const trace = (start: number, next: number) => {
        const path = [start]
        let previous = start
        let current = next
        edges.add(edgeKey(previous, current))

        while (true) {
            path.push(current)
            const adjacent = getNeighbors(current)
            const candidates = adjacent.filter(
                (candidate) => candidate !== previous && !edges.has(edgeKey(current, candidate)),
            )
            if (adjacent.length !== 2 || !candidates.length) break

            previous = current
            current = candidates[0] ?? current
            edges.add(edgeKey(previous, current))
        }

        return path
    }

    for (const point of points) {
        const adjacent = getNeighbors(point)
        if (adjacent.length === 0) {
            paths.push([point, point])
            continue
        }
        if (adjacent.length === 2) continue

        for (const next of adjacent) {
            if (!edges.has(edgeKey(point, next))) paths.push(trace(point, next))
        }
    }

    for (const point of points) {
        for (const next of getNeighbors(point)) {
            if (!edges.has(edgeKey(point, next))) paths.push(trace(point, next))
        }
    }

    return paths
}

const simplifyPath = (path: StrokePoint[], tolerance: number): StrokePoint[] => {
    if (path.length <= 2) return path

    const first = path[0]
    const last = path.at(-1)
    if (!first || !last) return path

    let furthestIndex = -1
    let furthestDistance = 0
    for (let i = 1; i < path.length - 1; i++) {
        const point = path[i]
        if (!point) continue
        const distance = pointToSegmentDistance(point, first, last)
        if (distance <= furthestDistance) continue
        furthestIndex = i
        furthestDistance = distance
    }

    if (furthestDistance <= tolerance || furthestIndex === -1) return [first, last]

    const before = simplifyPath(path.slice(0, furthestIndex + 1), tolerance)
    const after = simplifyPath(path.slice(furthestIndex), tolerance)
    return [...before.slice(0, -1), ...after]
}

const pointToSegmentDistance = (point: StrokePoint, start: StrokePoint, end: StrokePoint) => {
    const deltaX = end[0] - start[0]
    const deltaY = end[1] - start[1]
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1])

    const projection = Math.max(
        0,
        Math.min(
            1,
            ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared,
        ),
    )
    return Math.hypot(
        point[0] - (start[0] + projection * deltaX),
        point[1] - (start[1] + projection * deltaY),
    )
}
