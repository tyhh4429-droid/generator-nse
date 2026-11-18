import type { LevelDataEntity } from '@sonolus/core'
import type { GroupId, Groups } from '../../../chart/groups'

export const serializeGroupsToLevelDataEntities = (groups: Groups) =>
    new Map(
        [...groups.entries()].map(
            ([id, { name, forceNoteSpeed, textArt }]): [GroupId, LevelDataEntity] => [
                id,
                {
                    archetype: '#TIMESCALE_GROUP',
                    data: [
                        {
                            name: 'editorName',
                            ref: name,
                        },
                        ...(forceNoteSpeed
                            ? [
                                  {
                                      name: 'forceNoteSpeed',
                                      value: forceNoteSpeed,
                                  },
                              ]
                            : []),
                        ...(textArt
                            ? [
                                  {
                                      name: 'editorTextArt',
                                      ref: JSON.stringify(textArt),
                                  },
                              ]
                            : []),
                    ],
                },
            ],
        ),
    )
