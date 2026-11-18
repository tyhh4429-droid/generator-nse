import Type from 'typebox'
import { getOptionalRef, getOptionalValue, type ParseCtx } from '.'
import { parseTextArtGroupData } from '../../groups'

export const parseGroupsToChart = ({ entities, addGroup }: ParseCtx) => {
    for (const entity of entities) {
        if (entity.archetype !== '#TIMESCALE_GROUP') continue

        addGroup(entity.name, getOptionalRef(entity, 'editorName'), {
            forceNoteSpeed:
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                getOptionalValue(entity, 'forceNoteSpeed', forceNoteSpeedSchema) || undefined,
            textArt: parseTextArtGroupData(getOptionalRef(entity, 'editorTextArt')),
        })
    }
}

const forceNoteSpeedSchema = Type.Union([Type.Literal(0), Type.Number({ minimum: 1, maximum: 12 })])
