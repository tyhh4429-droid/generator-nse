import { onMounted, onUnmounted } from 'vue'
import { modals } from '../../modals'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { currentSidebar } from '../sidebars'
import { isTextArtMoveKeyPressed } from './keys'

const onKeydown = (event: KeyboardEvent) => {
    if (modals.length) return
    if (currentSidebar.value?.contains(document.activeElement)) return

    if (event.code === 'KeyT') {
        isTextArtMoveKeyPressed.value = true
        event.preventDefault()
        return
    }

    for (const [name, key] of Object.entries(settings.keyboardShortcuts) as [
        CommandName,
        string | undefined,
    ][]) {
        if (key !== event.key) continue

        void commands[name].execute()
    }
}

const onKeyup = (event: KeyboardEvent) => {
    if (event.code !== 'KeyT') return

    isTextArtMoveKeyPressed.value = false
    event.preventDefault()
}

const onBlur = () => {
    isTextArtMoveKeyPressed.value = false
}

export const useKeyboardControl = () => {
    onMounted(() => {
        addEventListener('keydown', onKeydown)
        addEventListener('keyup', onKeyup)
        addEventListener('blur', onBlur)
    })

    onUnmounted(() => {
        removeEventListener('keydown', onKeydown)
        removeEventListener('keyup', onKeyup)
        removeEventListener('blur', onBlur)
    })
}
