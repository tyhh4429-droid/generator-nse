<script setup lang="ts">
import { computed } from 'vue'
import { state } from '../history'
import { bpms } from '../history/bpms'
import { selectedEntities } from '../history/selectedEntities'
import { beatToTime } from '../state/integrals/bpms'
import { getSelectedAsciiArtGroups } from './asciiArt'
import LevelEditorHitbox from './entities/LevelEditorHitbox.vue'
import { ups } from './view'

const asciiArtGroups = computed(() =>
    getSelectedAsciiArtGroups(selectedEntities.value, state.value.groups, state.value.store),
)

const asciiArtBounds = computed(() =>
    (asciiArtGroups.value ?? []).map(({ groupId, notes }) => {
        const beatMin = Math.min(...notes.map((note) => note.beat))
        const beatMax = Math.max(...notes.map((note) => note.beat))
        const contentTop = beatToTime(bpms.value, beatMax) * ups.value
        const contentBottom = beatToTime(bpms.value, beatMin) * ups.value

        return {
            groupId,
            left: Math.min(...notes.map((note) => note.left)) - 0.15,
            right: Math.max(...notes.map((note) => note.left + note.size)) + 0.15,
            top: contentTop - 0.5,
            bottom: contentBottom + 0.5,
            contentTop,
            contentBottom,
        }
    }),
)
</script>

<template>
    <template v-if="asciiArtBounds.length">
        <g v-for="bounds in asciiArtBounds" :key="bounds.groupId">
            <rect
                :x="bounds.left"
                :y="bounds.top"
                :width="bounds.right - bounds.left"
                :height="bounds.bottom - bounds.top"
                stroke="#22d3ee"
                stroke-width="2.5"
                stroke-opacity="1"
                stroke-dasharray="8 4"
                fill="#22d3ee"
                fill-opacity="0.09"
            />
            <template v-if="asciiArtBounds.length === 1">
                <rect
                    :x="bounds.left - 0.21"
                    :y="(bounds.top + bounds.bottom) / 2 - 0.21"
                    width="0.42"
                    height="0.42"
                    fill="#67e8f9"
                    stroke="#083344"
                    stroke-width="1.5"
                />
                <rect
                    :x="bounds.right - 0.21"
                    :y="(bounds.top + bounds.bottom) / 2 - 0.21"
                    width="0.42"
                    height="0.42"
                    fill="#67e8f9"
                    stroke="#083344"
                    stroke-width="1.5"
                />
                <rect
                    :x="(bounds.left + bounds.right) / 2 - 0.21"
                    :y="bounds.contentTop - 0.21"
                    width="0.42"
                    height="0.42"
                    fill="#67e8f9"
                    stroke="#083344"
                    stroke-width="1.5"
                />
                <rect
                    :x="(bounds.left + bounds.right) / 2 - 0.21"
                    :y="bounds.contentBottom - 0.21"
                    width="0.42"
                    height="0.42"
                    fill="#67e8f9"
                    stroke="#083344"
                    stroke-width="1.5"
                />
            </template>
        </g>
    </template>
    <template v-else>
        <template v-for="entity in selectedEntities" :key="entity">
            <LevelEditorHitbox v-if="entity.hitbox" :hitbox="entity.hitbox" stroke-opacity="0.5" />
        </template>
    </template>
</template>
