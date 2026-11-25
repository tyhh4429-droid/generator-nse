/**
 * Calculates the exact Euclidean distance from each pixel
 * to the nearest background pixel (bitmap value === 0).
 *
 * Foreground pixels have non-zero values.
 * Background pixels have distance 0.
 */
export const euclideanDistanceTransform = (
    bitmap: Uint8Array,
    width: number,
    height: number,
): Float32Array => {
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        bitmap.length !== width * height
    ) {
        throw new RangeError('Invalid bitmap dimensions.')
    }

    const size = width * height
    const maxDimension = Math.max(width, height)

    // First-pass results: squared distances.
    const intermediate = new Float64Array(size)

    // Reusable 1D buffers.
    const source = new Float64Array(maxDimension)
    const target = new Float64Array(maxDimension)
    const vertices = new Int32Array(maxDimension)
    const boundaries = new Float64Array(maxDimension + 1)

    // Horizontal pass.
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width

        for (let x = 0; x < width; x++) {
            source[x] = bitmap[rowOffset + x] === 0 ? 0 : Infinity
        }

        distanceTransform1D(
            source,
            target,
            width,
            vertices,
            boundaries,
        )

        for (let x = 0; x < width; x++) {
            intermediate[rowOffset + x] = target[x]!
        }
    }

    // Vertical pass.
    const result = new Float32Array(size)

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            source[y] = intermediate[x + y * width]!
        }

        distanceTransform1D(
            source,
            target,
            height,
            vertices,
            boundaries,
        )

        for (let y = 0; y < height; y++) {
            result[x + y * width] = Math.sqrt(target[y]!)
        }
    }

    return result
}

/**
 * 1D squared Euclidean distance transform.
 * Uses the lower envelope of parabolas.
 */
const distanceTransform1D = (
    source: Float64Array,
    target: Float64Array,
    length: number,
    vertices: Int32Array,
    boundaries: Float64Array,
) => {
    let k = -1

    // Construct the lower envelope.
    for (let q = 0; q < length; q++) {
        if (!Number.isFinite(source[q])) continue

        let intersection = -Infinity

        while (k >= 0) {
            const p = vertices[k]!

            intersection =
                (source[q]! + q * q - source[p]! - p * p) /
                (2 * (q - p))

            if (intersection > boundaries[k]!) break

            k--
        }

        if (k < 0) {
            k = 0
            vertices[k] = q
            boundaries[k] = -Infinity
            boundaries[k + 1] = Infinity
        } else {
            k++
            vertices[k] = q
            boundaries[k] = intersection
            boundaries[k + 1] = Infinity
        }
    }

    // No background pixel exists in this 1D input.
    if (k < 0) {
        target.fill(Infinity, 0, length)
        return
    }

    // Evaluate the lower envelope.
    let envelope = 0

    for (let q = 0; q < length; q++) {
        while (boundaries[envelope + 1]! < q) {
            envelope++
        }

        const p = vertices[envelope]!
        const delta = q - p

        target[q] = delta * delta + source[p]!
    }
}
