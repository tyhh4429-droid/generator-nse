import { i18n } from '../i18n'

export type Groups = Map<GroupId, GroupObject>

export type TextArtGroupData = {
    version: 1
    text: string
    fontName?: string
    fontKey?: string
    fontMode: 'outline' | 'centerline'
    horizontalScale: number
    verticalScale: number
    strokeWidth: number
    horizontalBarThickness?: number
    width: number
    height: number
}

declare const idBrand: unique symbol

export type GroupId = number & { [idBrand]: never }

export type GroupObject = {
    name: string
    forceNoteSpeed?: number
    textArt?: TextArtGroupData
}

export const parseTextArtGroupData = (value: string | undefined): TextArtGroupData | undefined => {
    if (!value) return

    try {
        const data = JSON.parse(value) as Partial<TextArtGroupData>
        if (
            data.version !== 1 ||
            typeof data.text !== 'string' ||
            (data.fontMode !== 'outline' && data.fontMode !== 'centerline') ||
            !isFinitePositive(data.horizontalScale) ||
            !isFinitePositive(data.verticalScale) ||
            !isFinitePositive(data.strokeWidth) ||
            !isFinitePositive(data.width) ||
            typeof data.height !== 'number' ||
            !Number.isFinite(data.height) ||
            data.height < 0
        )
            return

        return {
            version: 1,
            text: data.text,
            ...(typeof data.fontName === 'string' ? { fontName: data.fontName } : {}),
            ...(typeof data.fontKey === 'string' ? { fontKey: data.fontKey } : {}),
            fontMode: data.fontMode,
            horizontalScale: data.horizontalScale,
            verticalScale: data.verticalScale,
            strokeWidth: data.strokeWidth,
            ...(isFinitePositive(data.horizontalBarThickness)
                ? { horizontalBarThickness: data.horizontalBarThickness }
                : {}),
            width: data.width,
            height: data.height,
        }
    } catch {
        return
    }
}

const isFinitePositive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0

let i = 1

export const addToGroups = (
    groups: Groups,
    name?: string,
    object: Omit<GroupObject, 'name'> = {},
) => {
    const id = i++ as GroupId
    name ??= groups.size
        ? `#${
              Math.max(
                  0,
                  ...[...groups.values()]
                      .map(({ name }) => (name.startsWith('#') ? +name.slice(1) : 0))
                      .filter(Number.isInteger),
              ) + 1
          }`
        : i18n.value.group.default

    groups.set(id, {
        name,
        ...object,
    })

    return [id, name] as const
}
