import type { Groups } from '../../chart/groups'
import type { Entity } from '../../state/entities'

export const getClipboardGroups = (entities: Entity[], groups: Groups): Groups => {
    const groupIds = new Set(
        entities.flatMap((entity) =>
            entity.type === 'note' || entity.type === 'timeScale' ? [entity.groupId] : [],
        ),
    )

    return new Map(
        [...groupIds].flatMap((groupId) => {
            const group = groups.get(groupId)
            return group ? [[groupId, group]] : []
        }),
    )
}
