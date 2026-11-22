import type { GroupId, GroupObject, Groups } from '../../chart/groups'
import type { Entity } from '../../state/entities'
import type { NoteEntity } from '../../state/entities/slides/note'
import type { Store } from '../../state/store'
import { characterToCjkPaths, isCjkStrokeCharacter } from './cjk'
import {
    customFontLineHeight,
    customFontToPaths,
    type CustomFontMode,
    type CustomStrokeFont,
} from './customFont'
import { characterToPaths } from './hershey'

export const ASCII_ART_GROUP_PREFIX = '[ASCII Art] '
export const TEXT_ART_GROUP_PREFIX = '[Text Art] '
export const IMAGE_ART_GROUP_PREFIX = '[Image Art] '

const artGroupPrefixes = [ASCII_ART_GROUP_PREFIX, TEXT_ART_GROUP_PREFIX, IMAGE_ART_GROUP_PREFIX]

export const toAsciiArtGroupName = (text: string) => {
    const normalized = text.normalize('NFC').replace(/\s+/g, ' ').trim()
    const label = Array.from(normalized).slice(0, 24).join('') || 'Untitled'
    const prefix = Array.from(text).some((character) => {
        const codePoint = character.codePointAt(0)
        return codePoint !== undefined && codePoint > 126
    })
        ? TEXT_ART_GROUP_PREFIX
        : ASCII_ART_GROUP_PREFIX
    return `${prefix}${label}`
}

export const isAsciiArtGroup = (group: GroupObject | undefined) =>
    artGroupPrefixes.some((prefix) => group?.name.startsWith(prefix))

export const isTextStrokeArtGroup = (group: GroupObject | undefined) =>
    !!group &&
    (group.name.startsWith(ASCII_ART_GROUP_PREFIX) || group.name.startsWith(TEXT_ART_GROUP_PREFIX))

export const getLegacyTextArtText = (group: GroupObject) => {
    const prefix = group.name.startsWith(TEXT_ART_GROUP_PREFIX)
        ? TEXT_ART_GROUP_PREFIX
        : ASCII_ART_GROUP_PREFIX
    return group.name.slice(prefix.length).replace(/ #\d+$/, '')
}

export const toImageArtGroupName = (filename: string) => {
    const normalized = filename
        .normalize('NFC')
        .replace(/\.[^.]+$/, '')
        .replace(/\s+/g, ' ')
        .trim()
    const label = Array.from(normalized).slice(0, 24).join('') || 'Untitled'
    return `${IMAGE_ART_GROUP_PREFIX}${label}`
}

export const isAsciiArtGroupId = (groups: Groups, groupId: GroupId) =>
    isAsciiArtGroup(groups.get(groupId))

export const getAsciiArtNotes = (store: Store, groupId: GroupId) => {
    const notes: NoteEntity[] = []

    for (const slideNotes of store.slides.note.values()) {
        for (const note of slideNotes) {
            if (note.groupId === groupId) notes.push(note)
        }
    }

    return notes
}

export const expandAsciiArtEntities = (entities: Entity[], groups: Groups, store: Store) => {
    const expanded = new Set(entities)
    const groupIds = new Set<GroupId>()

    for (const entity of entities) {
        if (entity.type !== 'note') continue
        if (!isAsciiArtGroupId(groups, entity.groupId)) continue

        groupIds.add(entity.groupId)
    }

    for (const groupId of groupIds) {
        for (const note of getAsciiArtNotes(store, groupId)) expanded.add(note)
    }

    return [...expanded]
}

export const getSelectedAsciiArtGroups = (entities: Entity[], groups: Groups, store: Store) => {
    const noteEntities = entities.filter((entity): entity is NoteEntity => entity.type === 'note')
    if (!noteEntities.length || noteEntities.length !== entities.length) return

    const groupIds = [...new Set(noteEntities.map((entity) => entity.groupId))]
    if (!groupIds.every((groupId) => isAsciiArtGroupId(groups, groupId))) return

    const selected = new Set(noteEntities)
    const selectedGroups = groupIds.map((groupId) => ({
        groupId,
        notes: getAsciiArtNotes(store, groupId),
    }))

    if (
        selectedGroups.some(
            ({ notes }) => !notes.length || notes.some((note) => !selected.has(note)),
        )
    )
        return

    if (
        selectedGroups.reduce((count, { notes }) => count + notes.length, 0) !== noteEntities.length
    )
        return

    return selectedGroups
}

export const getSelectedAsciiArtNotes = (entities: Entity[], groups: Groups, store: Store) => {
    const selectedGroups = getSelectedAsciiArtGroups(entities, groups, store)
    if (selectedGroups?.length !== 1) return

    return selectedGroups[0]?.notes
}

export type StrokePoint = readonly [x: number, y: number]

export type StrokeAnchor = {
    point: StrokePoint
    size: number
}

export type StrokeText = {
    bounds: {
        minX: number
        maxX: number
        minY: number
        maxY: number
    }
    strokes: StrokePoint[][]
    strokeSizes?: number[][]
}

export type StrokePrimitive =
    | {
          type: 'slide'
          points: StrokePoint[]
          sizes?: number[]
  }
    | {
          type: 'bar'
          y: number
          xMin: number
          xMax: number
      }

const horizontalBarThicknessPerLane = 0.25

export const getHorizontalBarThickness = (strokeWidth: number) =>
    Math.max(0.001, strokeWidth * horizontalBarThicknessPerLane)

export const getHorizontalBarBeatRange = (
    y: number,
    minY: number,
    maxY: number,
    verticalScale: number,
    thickness: number,
) => {
    const textHeight = Math.max(0, (maxY - minY) * verticalScale)
    const center = (y - minY) * verticalScale
    const start = Math.min(Math.max(0, center - thickness / 2), Math.max(0, textHeight - thickness))

    return [start, start + thickness] as const
}

export const getGeneratedStrokeHeight = (
    primitives: StrokePrimitive[],
    minY: number,
    maxY: number,
    verticalScale: number,
    horizontalBarThickness: number,
) =>
    Math.max(
        0,
        ...primitives.map((primitive) =>
            primitive.type === 'bar'
                ? getHorizontalBarBeatRange(
                      primitive.y,
                      minY,
                      maxY,
                      verticalScale,
                      horizontalBarThickness,
                  )[1]
                : (Math.max(...primitive.points.map(([, y]) => y)) - minY) * verticalScale,
        ),
    )

const lineHeight = 32
const asciiBaselineOffset = 11

export const normalizeStrokeText = (value: string, allowCustomCharacters = false) => {
    const text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')

    for (const character of text) {
        const code = character.charCodeAt(0)
        const isUnsupported = allowCustomCharacters
            ? /\p{Cc}/u.test(character)
            : code < 32 || (code > 126 && !isCjkStrokeCharacter(character))
        if (character !== '\n' && isUnsupported) {
            throw new Error('The text contains an unsupported character.')
        }
    }

    const lines = text.split('\n')
    if (!lines.some((line) => line.length)) throw new Error('Text is required.')
    if (lines.length > 8) throw new Error('A maximum of 8 lines is supported.')
    if (Math.max(...lines.map((line) => Array.from(line).length)) > 32) {
        throw new Error('A maximum of 32 characters per line is supported.')
    }

    return lines
}

export const vectorizeStrokeText = async (
    value: string,
    customFont?: CustomStrokeFont,
    customFontMode: CustomFontMode = 'outline',
): Promise<StrokeText> => {
    const lines = normalizeStrokeText(value, !!customFont)
    const strokes: StrokePoint[][] = []
    let maxX = 0

    if (customFont) {
        for (const character of lines.join('')) {
            if (!/\s/u.test(character) && customFont.font.charToGlyphIndex(character) === 0) {
                throw new Error(`The selected font does not contain ${character}.`)
            }
        }

        for (const [lineIndex, line] of lines.entries()) {
            const offsetY = (lines.length - 1 - lineIndex) * customFontLineHeight
            const glyphs = customFontToPaths(customFont.font, line, offsetY, customFontMode)
            strokes.push(...glyphs.paths)
            maxX = Math.max(maxX, glyphs.width)
        }

        return toStrokeText(lines, strokes, maxX, customFontLineHeight)
    }

    const cjkCharacters = new Set(
        lines.flatMap((line) =>
            Array.from(line).filter(
                (character) => character !== '\u3000' && character.charCodeAt(0) > 126,
            ),
        ),
    )
    await Promise.all(Array.from(cjkCharacters, characterToCjkPaths))

    for (const [lineIndex, line] of lines.entries()) {
        let cursorX = 0
        const offsetY = (lines.length - 1 - lineIndex) * lineHeight

        for (const character of line) {
            const glyph = await getGlyph(character)

            for (const path of glyph.paths) {
                if (path.length < 2) continue
                strokes.push(path.map(([x, y]) => [cursorX + x, offsetY + y]))
            }

            cursorX += glyph.width
        }

        maxX = Math.max(maxX, cursorX)
    }

    return toStrokeText(lines, strokes, maxX, lineHeight)
}

const toStrokeText = (
    lines: string[],
    strokes: StrokePoint[][],
    maxX: number,
    currentLineHeight: number,
): StrokeText => {
    if (!strokes.length) {
        return {
            bounds: { minX: 0, maxX, minY: 0, maxY: currentLineHeight * lines.length },
            strokes,
        }
    }

    const points = strokes.flat()
    return {
        bounds: {
            minX: 0,
            maxX,
            minY: Math.min(...points.map(([, y]) => y)),
            maxY: Math.max(...points.map(([, y]) => y)),
        },
        strokes,
    }
}

const getGlyph = async (character: string) => {
    if (character === '\u3000') {
        return {
            width: lineHeight,
            paths: [] satisfies StrokePoint[][],
        }
    }

    const asciiGlyph = (() => {
        if (character === '^') {
            return {
                width: 16,
                paths: [
                    [
                        [2, 3],
                        [8, 12],
                        [14, 3],
                    ],
                ] satisfies StrokePoint[][],
            }
        }
        if (character === '`') {
            return {
                width: 10,
                paths: [
                    [
                        [3, 12],
                        [7, 8],
                    ],
                ] satisfies StrokePoint[][],
            }
        }

        if (character.charCodeAt(0) <= 126) return characterToPaths(character)
    })()

    if (asciiGlyph) {
        return {
            ...asciiGlyph,
            paths: asciiGlyph.paths.map((path) =>
                path.map(([x, y]) => [x, y + asciiBaselineOffset] as const),
            ),
        }
    }

    return characterToCjkPaths(character)
}

export const decomposeStrokeText = ({
    strokes,
    strokeSizes,
}: StrokeText): StrokePrimitive[] => {
    const primitives: StrokePrimitive[] = []

    for (const [strokeIndex, stroke] of strokes.entries()) {
        const firstPoint = stroke[0]
        if (!firstPoint) continue

        const sizes = strokeSizes?.[strokeIndex]

        let slide: StrokePoint[] = [firstPoint]
        let slideSizes: number[] = sizes ? [sizes[0] ?? 1] : []
        let direction = 0

        const flushSlide = () => {
            const first = slide[0]
            const last = slide.at(-1)

            if (slide.length >= 2 && first && last) {
                const reversed = first[1] > last[1]

                primitives.push({
                    type: 'slide',
                    points: reversed ? [...slide].reverse() : [...slide],
                    ...(sizes
                        ? {
                              sizes: reversed
                                  ? [...slideSizes].reverse()
                                  : [...slideSizes],
                          }
                        : {}),
                })
            }

            slide = []
            slideSizes = []
            direction = 0
        }

        for (let i = 1; i < stroke.length; i++) {
            const previous = stroke[i - 1]
            const point = stroke[i]
            if (!previous || !point) continue

            const deltaY = point[1] - previous[1]
            const pointSize = sizes?.[i] ?? 1

            if (Math.abs(deltaY) < 0.001) {
                flushSlide()

                primitives.push({
                    type: 'bar',
                    y: point[1],
                    xMin: Math.min(previous[0], point[0]),
                    xMax: Math.max(previous[0], point[0]),
                })

                slide = [point]
                slideSizes = sizes ? [pointSize] : []
                continue
            }

            const nextDirection = Math.sign(deltaY)

            if (!slide.length) {
                slide = [previous]
                slideSizes = sizes ? [sizes[i - 1] ?? 1] : []
            }

            if (direction && direction !== nextDirection) {
                flushSlide()
                slide = [previous]
                slideSizes = sizes ? [sizes[i - 1] ?? 1] : []
            }

            slide.push(point)
            if (sizes) slideSizes.push(pointSize)

            direction = nextDirection
        }

        flushSlide()
    }

    return primitives
}
