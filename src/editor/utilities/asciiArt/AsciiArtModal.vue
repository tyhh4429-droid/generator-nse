<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { storageGet, storageSet, storageRemove } from '../../../storage'
import type { TextArtGroupData } from '../../../chart/groups'
import type { NoteObject } from '../../../chart/note'
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
import {
    decomposeStrokeText,
    getGeneratedStrokeHeight,
    getHorizontalBarBeatRange,
    getHorizontalBarThickness,
    toAsciiArtGroupName,
    vectorizeStrokeText,
    type StrokeText,
} from '../../asciiArt'
import {
    loadCustomStrokeFont,
    type CustomFontMode,
    type CustomStrokeFont,
} from '../../asciiArt/customFont'
import { notify } from '../../notification'
import { switchToolTo } from '../../tools'
import { view } from '../../view'

const emit = defineEmits<{
    close: []
}>()

const maxGeneratedNotes = 8000

const text = ref('SEKAI')
const fontFileName = ref<string>()
const customFont = shallowRef<CustomStrokeFont>()
    type SavedCustomFont = {
    name: string
    data: string
}

const savedFont = storageGet(
    'utilities.asciiArt.customFont',
    null,
) as SavedCustomFont | null

const encodeFont = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''

    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }

    return btoa(binary)
}

const decodeFont = (data: string) => {
    const binary = atob(data)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

    return bytes.buffer
}

const restoreFont = async () => {
    if (!savedFont || typeof savedFont.name !== 'string' || typeof savedFont.data !== 'string') {
        return
    }

    isFontLoading.value = true

    try {
        const file = new File(
            [decodeFont(savedFont.data)],
            savedFont.name,
        )

        customFont.value = await loadCustomStrokeFont(file)
        fontFileName.value = file.name
    } catch {
        storageRemove('utilities.asciiArt.customFont')
    } finally {
        isFontLoading.value = false
    }
}

type AsciiArtSettings = {
    customFontMode: CustomFontMode
    startBeat: number
    left: number
    horizontalScale: number
    verticalScale: number
    strokeWidth: number
    style: 'trace' | 'critical'
}

const savedSettings = storageGet(
    'utilities.asciiArt.settings',
    {},
) as Partial<AsciiArtSettings>

const getNumber = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

const customFontMode = ref<CustomFontMode>(
    savedSettings.customFontMode === 'centerline'
        ? 'centerline'
        : savedSettings.customFontMode === 'filled'
          ? 'filled'
          : 'outline',
)
const startBeat = ref(getNumber(savedSettings.startBeat, 0))
const left = ref(getNumber(savedSettings.left, -6.5))
const horizontalScale = ref(getNumber(savedSettings.horizontalScale, 0.15))
const verticalScale = ref(getNumber(savedSettings.verticalScale, 0.125))
const strokeWidth = ref(getNumber(savedSettings.strokeWidth, 1))
const style = ref<'trace' | 'critical'>(
    savedSettings.style === 'critical' ? 'critical' : 'trace',
)
const error = ref('')
const isPreviewLoading = ref(false)
const isFontLoading = ref(false)
const isLoading = computed(() => isPreviewLoading.value || isFontLoading.value)
const isGenerating = ref(false)
    void restoreFont()
    watch(
    [customFontMode, startBeat, left, horizontalScale, verticalScale, strokeWidth, style],
    () => {
        storageSet('utilities.asciiArt.settings', {
            customFontMode: customFontMode.value,
            startBeat: startBeat.value,
            left: left.value,
            horizontalScale: horizontalScale.value,
            verticalScale: verticalScale.value,
            strokeWidth: strokeWidth.value,
            style: style.value,
        })
    },
)

const emptyArt = (): StrokeText => ({
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    strokes: [],
})

const art = ref<StrokeText>(emptyArt())
let previewRequest = 0

watch(
    [text, customFont, customFontMode],
    async ([value, font, fontMode]) => {
        const request = ++previewRequest
        error.value = ''
        isPreviewLoading.value = true

        try {
            const result = await vectorizeStrokeText(value, font, fontMode)
            if (request === previewRequest) art.value = result
        } catch (err) {
            if (request !== previewRequest) return

            console.error('[AsciiArt] Preview failed:', err)

            art.value = emptyArt()
            error.value = err instanceof Error
                ? err.message
                : String(err)
        } finally {
            if (request === previewRequest) isPreviewLoading.value = false
        }
    },
    { immediate: true },
)

const loadFont = async (file: File) => {
    error.value = ''
    isFontLoading.value = true

    try {
        const font = await loadCustomStrokeFont(file)

        customFont.value = font
        fontFileName.value = file.name

        try {
            storageSet('utilities.asciiArt.customFont', {
                name: file.name,
                data: await encodeFont(file),
            })
        } catch {
            // Font vẫn sử dụng được trong phiên hiện tại.
        }
    } catch {
        error.value = i18n.value.utilities.asciiArt.fontInvalid
    } finally {
        isFontLoading.value = false
    }
}

const clearFont = () => {
    customFont.value = undefined
    fontFileName.value = undefined
    storageRemove('utilities.asciiArt.customFont')
    error.value = ''
}

const primitives = computed(() => decomposeStrokeText(art.value))
const previewWidth = computed(() => Math.max(1, art.value.bounds.maxX - art.value.bounds.minX))
const previewHeight = computed(() => Math.max(1, art.value.bounds.maxY - art.value.bounds.minY))
const previewPoints = computed(() =>
    art.value.strokes.map((stroke) =>
        stroke
            .map(([x, y]) => `${x - art.value.bounds.minX},${art.value.bounds.maxY - y}`)
            .join(' '),
    ),
)

const countGeneratedNotes = (strokes: ReturnType<typeof decomposeStrokeText>) =>
    strokes.reduce((count, stroke) => count + (stroke.type === 'bar' ? 2 : stroke.points.length), 0)

const generate = async () => {
    if (isGenerating.value) return
    isGenerating.value = true

    let strokeText: StrokeText
    try {
        strokeText = await vectorizeStrokeText(text.value, customFont.value, customFontMode.value)
    } catch (err) {
        console.error('[AsciiArt] Generate failed:', err)
        
        error.value = customFont.value
            ? i18n.value.utilities.asciiArt.fontMissingGlyph
            : i18n.value.utilities.asciiArt.invalid
        isGenerating.value = false
        return
    }

    const strokes = decomposeStrokeText(strokeText)
    if (!strokes.length) {
        error.value = i18n.value.utilities.asciiArt.empty
        isGenerating.value = false
        return
    }
    if (countGeneratedNotes(strokes) > maxGeneratedNotes) {
        error.value = i18n.value.utilities.asciiArt.tooMany
        isGenerating.value = false
        return
    }

    const transaction = createTransaction(state.value)
    const artWidth = Math.max(0, strokeText.bounds.maxX - strokeText.bounds.minX)
    const horizontalBarThickness = getHorizontalBarThickness(strokeWidth.value)
    const textArt: TextArtGroupData = {
        version: 1,
        text: text.value,
        ...(customFont.value
            ? {
                  fontName: customFont.value.name,
                  fontKey: customFont.value.key,
              }
            : {}),
        fontMode: customFontMode.value,
        horizontalScale: horizontalScale.value,
        verticalScale: verticalScale.value,
        strokeWidth: strokeWidth.value,
        horizontalBarThickness,
        width: artWidth * horizontalScale.value + strokeWidth.value,
        height: getGeneratedStrokeHeight(
            strokes,
            strokeText.bounds.minY,
            strokeText.bounds.maxY,
            verticalScale.value,
            horizontalBarThickness,
        ),
    }
    const groupId = transaction.createGroup(toAsciiArtGroupName(text.value), { textArt })
    const stageId = view.stageId ?? defaultStageId.value
    const isCritical = style.value === 'critical'

    const toNote = (
        x: number,
        y: number,
        size: number,
        noteType: NoteObject['noteType'],
    ): NoteObject => ({
        groupId,
        stageId,
        beat: startBeat.value + (y - strokeText.bounds.minY) * verticalScale.value,
        noteType,
        isAttached: false,
        left: left.value + (x - strokeText.bounds.minX) * horizontalScale.value - size / 2,
        size,
        isCritical,
        flickDirection: 'none',
        isFake: true,
        sfx: 'none',
        isConnectorSeparator: false,
        connectorType: 'guide',
        connectorEase: 'linear',
        connectorIsFake: true,
        connectorActiveIsCritical: isCritical,
        connectorGuideColor: isCritical ? 'yellow' : 'green',
        connectorGuideAlpha: 1,
        connectorLayer: 'top',
        connectorIsPassThrough: false,
        connectorPresentation: 'default',
    })

    const selected = strokes.flatMap((stroke) => {
        const slideId = createSlideId()

        if (stroke.type === 'bar') {
            const size = (stroke.xMax - stroke.xMin) * horizontalScale.value + strokeWidth.value
            const x = (stroke.xMin + stroke.xMax) / 2
            const head = toNote(x, stroke.y, size, 'anchor')
            const tail = toNote(x, stroke.y, size, 'anchor')
            const barThickness = stroke.sizeStart !== undefined
                ? Math.max(
                    0.5,
                    ((stroke.sizeStart + (stroke.sizeEnd ?? stroke.sizeStart)) / 2) *
                        verticalScale.value,
                )
              : horizontalBarThickness

            const [headOffset, tailOffset] = getHorizontalBarBeatRange(
                stroke.y,
                strokeText.bounds.minY,
                strokeText.bounds.maxY,
                verticalScale.value,
                barThickness,
            )
            head.beat = startBeat.value + headOffset
            tail.beat = startBeat.value + tailOffset

            return [...addNote(transaction, slideId, head), ...addNote(transaction, slideId, tail)]
        }

        return stroke.points.flatMap(([x, y], index) => {
            const filledSize = stroke.sizes?.[index]

            const size = filledSize !== undefined
                ? Math.max(strokeWidth.value, filledSize * horizontalScale.value)
                : strokeWidth.value

            return addNote(
                transaction,
                slideId,
                toNote(x, y, size, 'anchor'),
            )
        })
    })

    const message = interpolateRaw(i18n.value.utilities.asciiArt.generated, `${strokes.length}`)
    pushState(() => message, transaction.commit(selected))
    switchToolTo('select')
    notify(() => message)
    emit('close')
    isGenerating.value = false
}
</script>

<template>
    <FormModal :title="i18n.utilities.asciiArt.title" @close="$emit('close')" @submit="generate">
        <label class="flex flex-col gap-1">
            <span>{{ i18n.utilities.asciiArt.text }}</span>
            <textarea
                v-model="text"
                class="min-h-20 resize-y rounded bg-button px-3 py-2 font-mono shadow-md transition-colors hover:shadow-accent focus:bg-accent focus:text-button focus:outline-none"
                maxlength="263"
                required
            />
        </label>

        <div class="grid grid-cols-[minmax(0,1fr)_2.25rem] items-end gap-2">
            <FileField
                :label="i18n.utilities.asciiArt.font"
                :value="fontFileName"
                accept=".ttf,.otf,.woff"
                @select="loadFont"
            />
            <button
                class="h-8 w-9 rounded bg-button text-xl leading-none shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button disabled:cursor-not-allowed disabled:opacity-30"
                type="button"
                :title="i18n.utilities.asciiArt.clearFont"
                :aria-label="i18n.utilities.asciiArt.clearFont"
                :disabled="!customFont"
                @click="clearFont"
            >
                &times;
            </button>
        </div>
        <div v-if="customFont" class="text-xs text-white/60">
            {{ interpolateRaw(i18n.utilities.asciiArt.fontLoaded, customFont.name) }}
        </div>

        <SelectField
          v-if="customFont"
          v-model="customFontMode"
          :label="i18n.utilities.asciiArt.fontMode"
          :options="[
            [i18n.utilities.asciiArt.fontOutline, 'outline'],
            [i18n.utilities.asciiArt.fontCenterline, 'centerline'],
            [i18n.utilities.asciiArt.fontFilled, 'filled'],
          ]"
        />

        <div class="grid grid-cols-2 gap-2">
            <NumberField
                v-model="startBeat"
                :label="i18n.utilities.asciiArt.startBeat"
                :min="0"
                :step="0.25"
            />
            <NumberField v-model="left" :label="i18n.utilities.asciiArt.left" :step="0.25" />
            <NumberField
                v-model="horizontalScale"
                :label="i18n.utilities.asciiArt.horizontalScale"
                :min="0.01"
                :step="0.01"
            />
            <NumberField
                v-model="verticalScale"
                :label="i18n.utilities.asciiArt.verticalScale"
                :min="0.001"
                :step="0.001"
            />
            <NumberField
                v-model="strokeWidth"
                :label="i18n.utilities.asciiArt.strokeWidth"
                :min="0.125"
                :step="0.125"
            />
        </div>

        <SelectField
            v-model="style"
            :label="i18n.utilities.asciiArt.style"
            :options="[
                [i18n.utilities.asciiArt.trace, 'trace'],
                [i18n.utilities.asciiArt.critical, 'critical'],
            ]"
        />

        <div class="overflow-hidden rounded bg-preview p-2">
            <svg
                class="max-h-40 w-full"
                :viewBox="`-2 -2 ${previewWidth + 4} ${previewHeight + 4}`"
                preserveAspectRatio="xMidYMid meet"
                :aria-label="i18n.utilities.asciiArt.preview"
                role="img"
            >
                <polyline
                    v-for="(points, index) in previewPoints"
                    :key="index"
                    :points
                    fill="none"
                    :stroke="style === 'critical' ? '#ffd43b' : '#54e88b'"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </div>

        <div class="flex justify-between text-xs text-white/60">
            <span>{{ i18n.utilities.asciiArt.preview }}</span>
            <span v-if="isLoading">{{ i18n.utilities.asciiArt.loading }}</span>
            <span v-else>{{
                interpolateRaw(i18n.utilities.asciiArt.objects, `${primitives.length}`)
            }}</span>
        </div>
        <div v-if="error" class="text-sm text-red-400">{{ error }}</div>
    </FormModal>
</template>
