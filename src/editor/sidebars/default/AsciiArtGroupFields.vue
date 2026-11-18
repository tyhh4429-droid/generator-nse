<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { TextArtGroupData } from '../../../chart/groups'
import type { NoteObject } from '../../../chart/note'
import { pushState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import FileField from '../../../modals/form/FileField.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import SelectField from '../../../modals/form/SelectField.vue'
import { createSlideId } from '../../../state/entities/slides'
import type { NoteEntity } from '../../../state/entities/slides/note'
import { addNote, removeNote, replaceNote } from '../../../state/mutations/slides/note'
import { createTransaction } from '../../../state/transaction'
import { interpolateRaw } from '../../../utils/interpolate'
import {
    decomposeStrokeText,
    getGeneratedStrokeHeight,
    getHorizontalBarBeatRange,
    getHorizontalBarThickness,
    getLegacyTextArtText,
    getSelectedAsciiArtNotes,
    isTextStrokeArtGroup,
    toAsciiArtGroupName,
    vectorizeStrokeText,
} from '../../asciiArt'
import {
    getCustomStrokeFont,
    loadCustomStrokeFont,
    type CustomFontMode,
    type CustomStrokeFont,
} from '../../asciiArt/customFont'
import { notify } from '../../notification'

const maxGeneratedNotes = 8000

const notes = computed(() =>
    getSelectedAsciiArtNotes(selectedEntities.value, state.value.groups, state.value.store),
)

const bounds = computed(() => {
    if (!notes.value?.length) return

    return {
        left: Math.min(...notes.value.map((note) => note.left)),
        right: Math.max(...notes.value.map((note) => note.left + note.size)),
        beatMin: Math.min(...notes.value.map((note) => note.beat)),
        beatMax: Math.max(...notes.value.map((note) => note.beat)),
    }
})

const groupId = computed(() => notes.value?.[0]?.groupId)
const group = computed(() => {
    const id = groupId.value
    return id === undefined ? undefined : state.value.groups.get(id)
})
const storedTextArt = computed(() => group.value?.textArt)
const textArt = computed(() => {
    const currentGroup = group.value
    const currentBounds = bounds.value
    if (!currentGroup || !currentBounds || !isTextStrokeArtGroup(currentGroup)) return
    if (currentGroup.textArt) return currentGroup.textArt

    return {
        version: 1,
        text: getLegacyTextArtText(currentGroup),
        fontMode: 'outline',
        horizontalScale: 1,
        verticalScale: 1,
        strokeWidth: Math.min(...(notes.value ?? []).map((note) => note.size)),
        width: currentBounds.right - currentBounds.left,
        height: currentBounds.beatMax - currentBounds.beatMin,
    } satisfies TextArtGroupData
})
const text = ref('')
const fontMode = ref<CustomFontMode>('outline')
const customFont = shallowRef<CustomStrokeFont>()
const fontFileName = ref<string>()
const strokeWidth = ref(1)
const error = ref('')
const isApplying = ref(false)

const currentStrokeWidth = computed(() => {
    const currentNotes = notes.value
    const currentBounds = bounds.value
    const metadata = textArt.value
    if (!currentNotes?.length || !currentBounds || !metadata) return 1
    if (!storedTextArt.value) return Math.min(...currentNotes.map((note) => note.size))

    const currentWidth = currentBounds.right - currentBounds.left
    const horizontalTransform = metadata.width > 0 ? currentWidth / metadata.width : 1
    return metadata.strokeWidth * horizontalTransform
})

watch(
    [groupId, textArt, currentStrokeWidth],
    ([, metadata]) => {
        text.value = metadata?.text ?? ''
        fontMode.value = metadata?.fontMode ?? 'outline'
        customFont.value = getCustomStrokeFont(metadata?.fontKey)
        fontFileName.value = customFont.value ? metadata?.fontName : undefined
        strokeWidth.value = currentStrokeWidth.value
        error.value = ''
    },
    { immediate: true },
)

const loadFont = async (file: File) => {
    error.value = ''
    try {
        customFont.value = await loadCustomStrokeFont(file)
        fontFileName.value = file.name
    } catch {
        error.value = i18n.value.sidebars.asciiArt.fontInvalid
    }
}

const countGeneratedNotes = (strokes: ReturnType<typeof decomposeStrokeText>) =>
    strokes.reduce((count, stroke) => count + (stroke.type === 'bar' ? 2 : stroke.points.length), 0)

const updateText = async () => {
    const currentNotes = notes.value
    const currentBounds = bounds.value
    const currentGroup = group.value
    const metadata = textArt.value
    const id = groupId.value
    if (!currentNotes?.length || !currentBounds || !currentGroup || !metadata || id === undefined)
        return
    if (isApplying.value) return
    if (storedTextArt.value?.fontName && !customFont.value) {
        error.value = i18n.value.sidebars.asciiArt.fontRequired
        return
    }

    isApplying.value = true
    error.value = ''

    try {
        const strokeText = await vectorizeStrokeText(text.value, customFont.value, fontMode.value)
        const strokes = decomposeStrokeText(strokeText)
        if (!strokes.length) {
            error.value = i18n.value.sidebars.asciiArt.empty
            return
        }
        if (countGeneratedNotes(strokes) > maxGeneratedNotes) {
            error.value = i18n.value.sidebars.asciiArt.tooMany
            return
        }

        const currentWidth = currentBounds.right - currentBounds.left
        const currentHeight = currentBounds.beatMax - currentBounds.beatMin
        const artWidth = Math.max(0, strokeText.bounds.maxX - strokeText.bounds.minX)
        const artHeight = Math.max(0, strokeText.bounds.maxY - strokeText.bounds.minY)
        const isLegacy = !currentGroup.textArt
        const horizontalTransform = metadata.width > 0 ? currentWidth / metadata.width : 1
        const verticalTransform = metadata.height > 0 ? currentHeight / metadata.height : 1
        const previousStrokeWidth = isLegacy
            ? Math.min(...currentNotes.map((note) => note.size))
            : metadata.strokeWidth * horizontalTransform
        const nextStrokeWidth = Math.max(0.125, strokeWidth.value)
        const horizontalScale = isLegacy
            ? Math.max(0.001, (currentWidth - nextStrokeWidth) / Math.max(artWidth, 0.001))
            : metadata.horizontalScale * horizontalTransform
        const verticalScale = isLegacy
            ? Math.max(0.001, currentHeight / Math.max(artHeight, 0.001))
            : metadata.verticalScale * verticalTransform
        const previousHorizontalBarThickness = isLegacy
            ? getHorizontalBarThickness(previousStrokeWidth)
            : (metadata.horizontalBarThickness ?? getHorizontalBarThickness(metadata.strokeWidth)) *
              verticalTransform
        const horizontalBarThickness =
            previousHorizontalBarThickness *
            (nextStrokeWidth / Math.max(previousStrokeWidth, 0.001))
        const originLane = currentBounds.left + nextStrokeWidth / 2
        const template = currentNotes[0]
        if (!template) return

        const transaction = createTransaction(state.value)
        for (const note of currentNotes) removeNote(transaction, note)

        const toNote = (
            x: number,
            y: number,
            size: number,
            noteType: NoteObject['noteType'],
        ): NoteObject => ({
            groupId: id,
            stageId: template.stageId,
            beat: currentBounds.beatMin + (y - strokeText.bounds.minY) * verticalScale,
            noteType,
            isAttached: false,
            left: originLane + (x - strokeText.bounds.minX) * horizontalScale - size / 2,
            size,
            isCritical: template.isCritical,
            flickDirection: 'none',
            isFake: true,
            sfx: 'none',
            isConnectorSeparator: false,
            connectorType: 'guide',
            connectorEase: 'linear',
            connectorIsFake: true,
            connectorActiveIsCritical: template.connectorActiveIsCritical,
            connectorGuideColor: template.connectorGuideColor,
            connectorGuideAlpha: template.connectorGuideAlpha,
            connectorLayer: template.connectorLayer,
            connectorIsPassThrough: template.connectorIsPassThrough,
            connectorPresentation: template.connectorPresentation,
        })

        const selected = strokes.flatMap((stroke) => {
            const slideId = createSlideId()
            if (stroke.type === 'bar') {
                const size = (stroke.xMax - stroke.xMin) * horizontalScale + nextStrokeWidth
                const x = (stroke.xMin + stroke.xMax) / 2
                const head = toNote(x, stroke.y, size, 'anchor')
                const tail = toNote(x, stroke.y, size, 'anchor')
                const [headOffset, tailOffset] = getHorizontalBarBeatRange(
                    stroke.y,
                    strokeText.bounds.minY,
                    strokeText.bounds.maxY,
                    verticalScale,
                    horizontalBarThickness,
                )
                head.beat = currentBounds.beatMin + headOffset
                tail.beat = currentBounds.beatMin + tailOffset

                return [
                    ...addNote(transaction, slideId, head),
                    ...addNote(transaction, slideId, tail),
                ]
            }

            return stroke.points.flatMap(([x, y]) =>
                addNote(transaction, slideId, toNote(x, y, nextStrokeWidth, 'anchor')),
            )
        })

        const nextMetadata: TextArtGroupData = {
            version: 1,
            text: text.value,
            ...(customFont.value
                ? {
                      fontName: customFont.value.name,
                      fontKey: customFont.value.key,
                  }
                : {}),
            fontMode: fontMode.value,
            horizontalScale,
            verticalScale,
            strokeWidth: nextStrokeWidth,
            horizontalBarThickness,
            width: artWidth * horizontalScale + nextStrokeWidth,
            height: getGeneratedStrokeHeight(
                strokes,
                strokeText.bounds.minY,
                strokeText.bounds.maxY,
                verticalScale,
                horizontalBarThickness,
            ),
        }
        const suffix = / #\d+$/.exec(currentGroup.name)?.[0] ?? ''
        const nextState = transaction.commit(selected)
        const groups = new Map(nextState.groups)
        groups.set(id, {
            ...currentGroup,
            name: `${toAsciiArtGroupName(text.value)}${suffix}`,
            textArt: nextMetadata,
        })

        const message = interpolateRaw(
            i18n.value.sidebars.asciiArt.textUpdated,
            `${selected.length}`,
        )
        pushState(() => message, { ...nextState, groups })
        notify(() => message)
    } catch {
        error.value = customFont.value
            ? i18n.value.sidebars.asciiArt.fontMissingGlyph
            : i18n.value.sidebars.asciiArt.invalid
    } finally {
        isApplying.value = false
    }
}

const transform = (map: (note: NoteEntity) => { left: number; size: number; beat: number }) => {
    if (!notes.value) return

    const transaction = createTransaction(state.value)
    const transformed = notes.value.flatMap((note) =>
        replaceNote(transaction, note, {
            ...note,
            ...map(note),
        }),
    )

    const message = interpolateRaw(
        i18n.value.sidebars.asciiArt.transformed,
        `${transformed.length}`,
    )
    pushState(() => message, transaction.commit(transformed))
    notify(() => message)
}

const left = computed({
    get: () => bounds.value?.left ?? 0,
    set: (value: number) => {
        if (!bounds.value) return
        const offset = value - bounds.value.left
        transform((note) => ({ left: note.left + offset, size: note.size, beat: note.beat }))
    },
})

const beat = computed({
    get: () => bounds.value?.beatMin ?? 0,
    set: (value: number) => {
        if (!bounds.value) return
        const offset = value - bounds.value.beatMin
        transform((note) => ({ left: note.left, size: note.size, beat: note.beat + offset }))
    },
})

const width = computed({
    get: () => (bounds.value ? bounds.value.right - bounds.value.left : 0),
    set: (value: number) => {
        const currentBounds = bounds.value
        if (!currentBounds) return
        const current = currentBounds.right - currentBounds.left
        if (current <= 0 || value <= 0) return

        const scale = value / current
        transform((note) => ({
            left: currentBounds.left + (note.left - currentBounds.left) * scale,
            size: note.size * scale,
            beat: note.beat,
        }))
    },
})

const height = computed({
    get: () => (bounds.value ? bounds.value.beatMax - bounds.value.beatMin : 0),
    set: (value: number) => {
        const currentBounds = bounds.value
        if (!currentBounds) return
        const current = currentBounds.beatMax - currentBounds.beatMin
        if (current <= 0 || value <= 0) return

        const scale = value / current
        transform((note) => ({
            left: note.left,
            size: note.size,
            beat: currentBounds.beatMin + (note.beat - currentBounds.beatMin) * scale,
        }))
    },
})
</script>

<template>
    <div v-if="notes" class="mb-2 flex flex-col gap-2 border-b border-white/10 pb-4">
        <div class="font-bold">{{ i18n.sidebars.asciiArt.title }}</div>
        <template v-if="textArt">
            <label class="flex flex-col gap-1">
                <span>{{ i18n.sidebars.asciiArt.text }}</span>
                <textarea
                    v-model="text"
                    class="min-h-16 resize-y rounded bg-button px-3 py-2 shadow-md transition-colors hover:shadow-accent focus:bg-accent focus:text-button focus:outline-none"
                    maxlength="263"
                />
            </label>
            <FileField
                v-if="(!storedTextArt || textArt.fontName) && !customFont"
                :label="i18n.sidebars.asciiArt.font"
                :value="fontFileName"
                accept=".ttf,.otf,.woff"
                @select="loadFont"
            />
            <SelectField
                v-if="textArt.fontName || customFont"
                v-model="fontMode"
                :label="i18n.sidebars.asciiArt.fontMode"
                :options="[
                    [i18n.sidebars.asciiArt.fontOutline, 'outline'],
                    [i18n.sidebars.asciiArt.fontCenterline, 'centerline'],
                ]"
            />
            <NumberField
                v-model="strokeWidth"
                :label="i18n.sidebars.asciiArt.strokeWidth"
                :min="0.125"
                :step="0.125"
            />
            <button
                class="self-end rounded-full bg-accent px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-button active:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="isApplying || !text.trim()"
                @click="updateText"
            >
                {{ i18n.sidebars.asciiArt.updateText }}
            </button>
            <div v-if="error" class="text-sm text-red-400">{{ error }}</div>
        </template>
        <div class="grid grid-cols-2 gap-2">
            <NumberField v-model="left" :label="i18n.sidebars.asciiArt.left" :step="0.125" />
            <NumberField
                v-model="beat"
                :label="i18n.sidebars.asciiArt.beat"
                :min="0"
                :step="0.03125"
            />
            <NumberField
                v-model="width"
                :label="i18n.sidebars.asciiArt.width"
                :min="0.125"
                :step="0.125"
            />
            <NumberField
                v-model="height"
                :label="i18n.sidebars.asciiArt.height"
                :min="0.03125"
                :step="0.03125"
            />
        </div>
    </div>
</template>
