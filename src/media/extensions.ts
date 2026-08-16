export const VIDEO_MEDIA_EXTENSIONS = [
  'mp4', 'mov', 'qt', 'mkv', 'webm', 'mxf', 'gxf', 'avi', 'm4v', 'mts', 'm2ts', 'ts',
  'mpeg', 'mpg', 'mpe', 'm2v', 'm1v', 'm2p', 'vob', '3gp', 'dv', 'flv', 'f4v', 'wmv',
  'asf', 'ogv', 'mjpeg', 'mjpg', 'y4m', 'nut', 'r3d', 'braw', 'crm', 'ari', 'cin',
] as const

export const AUDIO_MEDIA_EXTENSIONS = [
  'mp3', 'mp2', 'mpa', 'wav', 'bwf', 'rf64', 'm4a', 'aac', 'adts', 'flac', 'ogg', 'oga',
  'aif', 'aiff', 'caf', 'w64', 'ac3', 'eac3', 'opus', 'ape', 'amr', 'mka', 'au', 'snd',
] as const

export const IMAGE_MEDIA_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'jpe', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'tga',
  'dpx', 'exr', 'hdr', 'psd', 'jp2', 'j2k', 'j2c', 'jpf', 'jpx', 'sgi', 'pic',
] as const

export const MEDIA_EXTENSIONS = [...VIDEO_MEDIA_EXTENSIONS, ...AUDIO_MEDIA_EXTENSIONS, ...IMAGE_MEDIA_EXTENSIONS] as const
export const videoMediaExtensions = new Set<string>(VIDEO_MEDIA_EXTENSIONS)
export const audioMediaExtensions = new Set<string>(AUDIO_MEDIA_EXTENSIONS)
export const imageMediaExtensions = new Set<string>(IMAGE_MEDIA_EXTENSIONS)

export const MEDIA_FILE_ACCEPT = `video/*,audio/*,image/*,${MEDIA_EXTENSIONS.map((extension) => `.${extension}`).join(',')}`
export const IMAGE_FILE_ACCEPT = `image/*,${IMAGE_MEDIA_EXTENSIONS.map((extension) => `.${extension}`).join(',')}`
export const mediaFileExtensionPattern = new RegExp(`\\.(${MEDIA_EXTENSIONS.join('|')})$`, 'i')

const nativeStreamingImageExtensions = new Set(['heic', 'heif', 'tif', 'tiff', 'tga', 'dpx', 'exr', 'hdr', 'psd', 'jp2', 'j2k', 'j2c', 'jpf', 'jpx', 'sgi', 'pic'])

export function mediaExtension(name: string): string {
  return name.split('.').pop()?.toLocaleLowerCase() ?? ''
}

export function shouldStreamDesktopMedia(name: string): boolean {
  const extension = mediaExtension(name)
  return videoMediaExtensions.has(extension) || audioMediaExtensions.has(extension) || nativeStreamingImageExtensions.has(extension)
}

export function mediaMimeType(name: string): string {
  const extension = mediaExtension(name)
  if (['mp3', 'mp2', 'mpa'].includes(extension)) return 'audio/mpeg'
  if (extension === 'm4a') return 'audio/mp4'
  if (['wav', 'bwf', 'rf64'].includes(extension)) return 'audio/wav'
  if (extension === 'flac') return 'audio/flac'
  if (extension === 'aac' || extension === 'adts') return 'audio/aac'
  if (extension === 'ogg' || extension === 'oga') return 'audio/ogg'
  if (extension === 'opus') return 'audio/opus'
  if (extension === 'caf') return 'audio/x-caf'
  if (extension === 'w64') return 'audio/x-w64'
  if (extension === 'ac3') return 'audio/ac3'
  if (extension === 'eac3') return 'audio/eac3'
  if (extension === 'ape') return 'audio/x-ape'
  if (extension === 'amr') return 'audio/amr'
  if (extension === 'mka') return 'audio/x-matroska'
  if (extension === 'aif' || extension === 'aiff') return 'audio/aiff'
  if (extension === 'au' || extension === 'snd') return 'audio/basic'
  if (['jpg', 'jpeg', 'jpe'].includes(extension)) return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'avif') return 'image/avif'
  if (extension === 'heic' || extension === 'heif') return 'image/heif'
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'jp2' || extension === 'j2k' || extension === 'j2c' || extension === 'jpf' || extension === 'jpx') return 'image/jp2'
  if (extension === 'tga') return 'image/x-tga'
  if (extension === 'dpx') return 'image/x-dpx'
  if (extension === 'exr') return 'image/x-exr'
  if (extension === 'hdr') return 'image/vnd.radiance'
  if (extension === 'psd') return 'image/vnd.adobe.photoshop'
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mkv') return 'video/x-matroska'
  if (extension === 'webm') return 'video/webm'
  if (extension === 'avi') return 'video/x-msvideo'
  if (extension === 'mts' || extension === 'm2ts' || extension === 'ts') return 'video/mp2t'
  if (extension === 'dv') return 'video/dv'
  if (extension === 'flv' || extension === 'f4v') return 'video/x-flv'
  if (extension === 'wmv' || extension === 'asf') return 'video/x-ms-wmv'
  if (extension === 'ogv') return 'video/ogg'
  if (['mpeg', 'mpg', 'mpe', 'm2v', 'm1v', 'm2p'].includes(extension)) return 'video/mpeg'
  if (extension === '3gp') return 'video/3gpp'
  if (extension === 'mxf') return 'application/mxf'
  return 'video/mp4'
}
