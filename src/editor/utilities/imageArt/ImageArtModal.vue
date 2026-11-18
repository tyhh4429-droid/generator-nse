<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { GroupId } from '../../../chart/groups'
import type { ConnectorGuideColor, NoteObject } from '../../../chart/note'
import type { StageId } from '../../../chart/stages'
import { pushState, state } from '../../../history'
import { defaultStageId } from '../../../history/stages'
import { i18n } from '../../../i18n'
import FileField from '../../../modals/form/FileField.vue'
import FormModal from '../../../modals/form/FormModal.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import SelectField from '../../../modals/form/SelectField.vue'
import { createSlideId } from '../../../state/entities/slides'
import { addNote } from '../../../state/mutations/slides/note'
import { createTransaction } from '../../../state/transaction'
import { interpolateRaw } from '../../../utils/interpolate'
import { toImageArtGroupName } from '../../asciiArt'
import {
    MAX_IMAGE_ART_ANCHORS,
    getVerticalImageArtRuns,
    paintImageArtPreview,
    rasterizeImageArt,
    type BinaryImageArt,
    type ImageArtForeground,
} from '../../imageArt'
import { notify } from '../../notification'
import { switchToolTo } from '../../tools'
import { view } from '../../view'

const emit = defineEmits<{
    close: []
}>()

const fileName = ref<string>()
const source = shallowRef<HTMLCanvasElement>()
const startBeat = ref(0)
const left = ref(-6.5)
const width = ref(13)
const rowSpacing = ref(0.125)
const anchorWidth = ref(0.5)
const threshold = ref(128)
const foreground = ref<ImageArtForeground>('dark')
const color = ref<ConnectorGuideColor>('green')
const error = ref('')
const isLoading = ref(false)
const isGenerating = ref(false)
const previewCanvas = ref<HTMLCanvasElement>()

const emptyArt = (): BinaryImageArt => ({
    width: 0,
    height: 0,
    pixels: new Uint8Array(),
    count: 0,
})
const art = ref<BinaryImageArt>(emptyArt())
const runs = computed(() => getVerticalImageArtRuns(art.value))
const anchorCount = computed(() => runs.value.length * 2)

const refreshArt = () => {
    if (!source.value) {
        art.value = emptyArt()
    } else {
        art.value = rasterizeImageArt(
            source.value,
            threshold.value,
            foreground.value,
            width.value,
            anchorWidth.value,
        )
        error.value = !art.value.count
            ? i18n.value.utilities.imageArt.empty
            : anchorCount.value > MAX_IMAGE_ART_ANCHORS
              ? i18n.value.utilities.imageArt.tooMany
              : ''
    }

    void nextTick(() => {
        if (previewCanvas.value) paintImageArtPreview(previewCanvas.value, art.value)
    })
}

watch([source, threshold, foreground, width, anchorWidth], refreshArt, { immediate: true })

const loadFile = async (file: File) => {
    isLoading.value = true
    error.value = ''

    try {
        const bitmap = await createImageBitmap(file)
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))

        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Canvas is unavailable')

        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()

        fileName.value = file.name
        source.value = canvas
    } catch {
        source.value = undefined
        fileName.value = undefined
        art.value = emptyArt()
        error.value = i18n.value.utilities.imageArt.invalid
    } finally {
        isLoading.value = false
    }
}

const toNote = (groupId: GroupId, stageId: StageId, column: number, beat: number): NoteObject => ({
    groupId,
    stageId,
    beat,
    noteType: 'anchor',
    isAttached: false,
    left: left.value + column * anchorWidth.value,
    size: anchorWidth.value,
    isCritical: false,
    flickDirection: 'none',
    isFake: true,
    sfx: 'none',
    isConnectorSeparator: false,
    connectorType: 'guide',
    connectorEase: 'linear',
    connectorIsFake: true,
    connectorActiveIsCritical: false,
    connectorGuideColor: color.value,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
})

const generate = () => {
    if (isGenerating.value) return
    error.value = ''

    if (!source.value || !fileName.value) {
        error.value = i18n.value.utilities.imageArt.select
        return
    }
    if (!art.value.count) {
        error.value = i18n.value.utilities.imageArt.empty
        return
    }
    if (anchorCount.value > MAX_IMAGE_ART_ANCHORS) {
        error.value = i18n.value.utilities.imageArt.tooMany
        return
    }

    isGenerating.value = true
    const transaction = createTransaction(state.value)
    const groupId = transaction.createGroup(toImageArtGroupName(fileName.value))
    const stageId = view.stageId ?? defaultStageId.value
    const selected = []

    for (const run of runs.value) {
        const slideId = createSlideId()
        const bottomBeat = startBeat.value + (art.value.height - 1 - run.endRow) * rowSpacing.value
        const topBeat = startBeat.value + (art.value.height - run.startRow) * rowSpacing.value

        selected.push(
            ...addNote(transaction, slideId, toNote(groupId, stageId, run.column, bottomBeat)),
            ...addNote(transaction, slideId, toNote(groupId, stageId, run.column, topBeat)),
        )
    }

    const message = interpolateRaw(
        i18n.value.utilities.imageArt.generated,
        `${runs.value.length}`,
        `${selected.length}`,
    )
    pushState(() => message, transaction.commit(selected))
    switchToolTo('select')
    notify(() => message)
    emit('close')
    isGenerating.value = false
}
</script>

<template>
    <FormModal :title="i18n.utilities.imageArt.title" @close="$emit('close')" @submit="generate">
        <FileField :label="i18n.utilities.imageArt.image" :value="fileName" @select="loadFile" />

        <div class="grid grid-cols-2 gap-2">
            <NumberField
                v-model="startBeat"
                :label="i18n.utilities.imageArt.startBeat"
                :min="0"
                :step="0.25"
            />
            <NumberField v-model="left" :label="i18n.utilities.imageArt.left" :step="0.25" />
            <NumberField
                v-model="width"
                :label="i18n.utilities.imageArt.width"
                :min="0.125"
                :max="128"
                :step="0.125"
            />
            <NumberField
                v-model="rowSpacing"
                :label="i18n.utilities.imageArt.rowSpacing"
                :min="0.001"
                :step="0.001"
            />
            <NumberField
                v-model="anchorWidth"
                :label="i18n.utilities.imageArt.anchorWidth"
                :min="0.125"
                :max="128"
                :step="0.125"
            />
            <SelectField
                v-model="foreground"
                :label="i18n.utilities.imageArt.foreground"
                :options="[
                    [i18n.utilities.imageArt.dark, 'dark'],
                    [i18n.utilities.imageArt.light, 'light'],
                ]"
            />
            <SelectField
                v-model="color"
                :label="i18n.utilities.imageArt.color"
                :options="[
                    [i18n.utilities.imageArt.green, 'green'],
                    [i18n.utilities.imageArt.yellow, 'yellow'],
                ]"
            />
        </div>

        <label class="flex flex-col gap-1">
            <span class="flex justify-between">
                <span>{{ i18n.utilities.imageArt.threshold }}</span>
                <span>{{ threshold }}</span>
            </span>
            <input v-model.number="threshold" type="range" min="0" max="255" step="1" />
        </label>

        <div
            class="flex min-h-20 items-center justify-center overflow-hidden rounded bg-preview p-2"
        >
            <canvas
                ref="previewCanvas"
                class="max-h-56 max-w-full"
                style="image-rendering: pixelated"
                :aria-label="i18n.utilities.imageArt.preview"
                role="img"
            />
        </div>

        <div class="flex justify-between text-xs text-white/60">
            <span>{{ i18n.utilities.imageArt.preview }}</span>
            <span v-if="isLoading">{{ i18n.utilities.imageArt.loading }}</span>
            <span v-else-if="art.width && art.height">
                {{
                    interpolateRaw(
                        i18n.utilities.imageArt.resolution,
                        `${art.width}`,
                        `${art.height}`,
                        `${runs.length}`,
                        `${anchorCount}`,
                    )
                }}
            </span>
        </div>
        <div v-if="error" class="text-sm text-red-400">{{ error }}</div>
    </FormModal>
</template>
