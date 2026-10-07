import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const COLLAPSE_KEY = 'bpfmps.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Shared shell state. The sidebar collapse preference persists per browser; the
 * mobile drawer and command palette are transient and reset on navigation.
 */
const collapsed = ref(readCollapsed())
const drawerOpen = ref(false)
const paletteOpen = ref(false)

export function useShell() {
  function toggleCollapsed() {
    collapsed.value = !collapsed.value
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed.value))
    } catch {
      // Storage can be unavailable; the choice then lasts for this page only.
    }
  }

  function openPalette() {
    paletteOpen.value = true
  }

  return {
    collapsed,
    drawerOpen,
    paletteOpen,
    toggleCollapsed,
    openPalette,
    /** Labels hide only on desktop, so the mobile drawer always shows full labels. */
    labelClass: computed(() => (collapsed.value ? 'lg:hidden' : '')),
  }
}

/** Registers global shortcuts for the shell. Call once from the root component. */
export function useShellShortcuts(enabled: () => boolean) {
  function onKeydown(event: KeyboardEvent) {
    if (!enabled()) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      paletteOpen.value = !paletteOpen.value
      return
    }
    if (event.key === 'Escape') {
      if (paletteOpen.value) paletteOpen.value = false
      else if (drawerOpen.value) drawerOpen.value = false
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
