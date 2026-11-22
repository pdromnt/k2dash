import { getUploadBaseUrl } from '@/utils/env'
import { isPreview } from '@/utils/preview'

export async function uploadGcodeFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (isPreview) throw new Error('Uploads are disabled in preview')
  const filename = encodeURIComponent(file.name)
  const url = `${getUploadBaseUrl()}/upload/${filename}`

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.timeout = 300000

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Upload error')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
    xhr.addEventListener('timeout', () => reject(new Error('Upload timed out')))

    const formData = new FormData()
    formData.append('file', file)
    xhr.send(formData)
  })
}
