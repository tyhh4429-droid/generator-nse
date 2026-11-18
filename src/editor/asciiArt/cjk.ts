import type { StrokePoint } from '.'
import { clamp } from '../../utils/math'

type CharacterData = {
    medians?: unknown
}

type StrokeGlyph = {
    width: number
    paths: StrokePoint[][]
}

const chineseDataUrl = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1'
const japaneseDataUrl = 'https://cdn.jsdelivr.net/npm/@k1low/hanzi-writer-data-jp@0.8.0'

const glyphSize = 28
const glyphPadding = 2
const sourceSize = 1024

const glyphs = new Map<string, Promise<StrokeGlyph>>()

const isHanCharacter = (character: string) => /^\p{Script=Han}$/u.test(character)
const isJapaneseCharacter = (character: string) =>
    /^[\u3000-\u30ff\u31f0-\u31ff\uff01-\uff60]$/u.test(character)

export const isCjkStrokeCharacter = (character: string) =>
    isHanCharacter(character) || isJapaneseCharacter(character)

export const characterToCjkPaths = (character: string) => {
    const cached = glyphs.get(character)
    if (cached) return cached

    const promise = loadCharacter(character).catch((error: unknown) => {
        glyphs.delete(character)
        throw error
    })
    glyphs.set(character, promise)
    return promise
}

const loadCharacter = async (character: string): Promise<StrokeGlyph> => {
    const sources = isJapaneseCharacter(character)
        ? [japaneseDataUrl]
        : [chineseDataUrl, japaneseDataUrl]

    for (const source of sources) {
        const response = await fetch(`${source}/${encodeURIComponent(character)}.json`)
        if (response.status === 404) continue
        if (!response.ok) throw new Error(`Failed to load stroke data (${response.status}).`)

        const data = (await response.json()) as CharacterData
        const paths = parseMedians(data.medians)
        if (!paths.length) continue

        return {
            width: glyphSize + glyphPadding * 2,
            paths,
        }
    }

    throw new Error(`No stroke data is available for ${character}.`)
}

const parseMedians = (value: unknown): StrokePoint[][] => {
    if (!Array.isArray(value)) return []

    return value.flatMap((median) => {
        if (!Array.isArray(median)) return []

        const path: StrokePoint[] = []
        for (const point of median) {
            if (
                !Array.isArray(point) ||
                point.length < 2 ||
                typeof point[0] !== 'number' ||
                typeof point[1] !== 'number'
            )
                continue

            const next = [
                glyphPadding + (clamp(point[0], 0, sourceSize) / sourceSize) * glyphSize,
                glyphPadding + (clamp(point[1], 0, sourceSize) / sourceSize) * glyphSize,
            ] as const
            const previous = path.at(-1)
            if (previous?.[0] === next[0] && previous[1] === next[1]) continue

            path.push(next)
        }

        return path.length >= 2 ? [path] : []
    })
}
