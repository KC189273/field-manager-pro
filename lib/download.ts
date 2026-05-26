import { isCapacitor } from './gps-native'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Download a file from a blob.
 *
 * - Browser: standard blob + anchor-click approach
 * - Capacitor/iOS: Web Share API with a File object (iOS share sheet)
 * - Capacitor/Android: @capacitor/filesystem writes to cache, @capacitor/share opens it
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isCapacitor()) {
    // iOS: Web Share API supports sharing File objects directly
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      const file = new File([blob], filename, { type: blob.type })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return
      }
    }

    // Android (and iOS fallback): write to cache dir, then share/open
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const { Share } = await import('@capacitor/share')

      const base64 = await blobToBase64(blob)
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
      })
      const { uri } = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache,
      })
      await Share.share({
        title: filename,
        url: uri,
        dialogTitle: 'Open or save file',
      })
      return
    } catch (e) {
      console.error('Capacitor download error:', e)
      // Fall through to browser method as last resort
    }
  }

  // Standard browser download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
