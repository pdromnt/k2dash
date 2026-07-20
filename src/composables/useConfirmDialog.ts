import { reactive } from 'vue'

export interface ConfirmationOptions {
  title: string
  message: string
  subject?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'warning' | 'default'
  requiredText?: string
}

export interface TextInputOptions {
  title: string
  message: string
  inputLabel: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

export const confirmationDialog = reactive({
  open: false,
  mode: 'confirmation' as 'confirmation' | 'text-input',
  title: '',
  message: '',
  subject: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  tone: 'default' as NonNullable<ConfirmationOptions['tone']>,
  requiredText: '',
  inputLabel: '',
  initialValue: '',
  placeholder: '',
})

let resolveRequest: ((result: boolean | string | null) => void) | null = null

function cancelActiveRequest() {
  resolveRequest?.(null)
  resolveRequest = null
}

export function requestConfirmation(options: ConfirmationOptions): Promise<boolean> {
  cancelActiveRequest()

  Object.assign(confirmationDialog, {
    open: true,
    mode: 'confirmation',
    title: options.title,
    message: options.message,
    subject: options.subject || '',
    confirmLabel: options.confirmLabel || 'Confirm',
    cancelLabel: options.cancelLabel || 'Cancel',
    tone: options.tone || 'default',
    requiredText: options.requiredText || '',
    inputLabel: '',
    initialValue: '',
    placeholder: '',
  })

  return new Promise<boolean>((resolve) => {
    resolveRequest = (result) => resolve(result === true)
  })
}

export function requestTextInput(options: TextInputOptions): Promise<string | null> {
  cancelActiveRequest()

  Object.assign(confirmationDialog, {
    open: true,
    mode: 'text-input',
    title: options.title,
    message: options.message,
    subject: '',
    confirmLabel: options.confirmLabel || 'Save',
    cancelLabel: options.cancelLabel || 'Cancel',
    tone: 'default',
    requiredText: '',
    inputLabel: options.inputLabel,
    initialValue: options.initialValue || '',
    placeholder: options.placeholder || '',
  })

  return new Promise<string | null>((resolve) => {
    resolveRequest = (result) => resolve(typeof result === 'string' ? result : null)
  })
}

export function resolveConfirmation(confirmed: boolean) {
  confirmationDialog.open = false
  const resolve = resolveRequest
  resolveRequest = null
  resolve?.(confirmed)
}

export function resolveTextInput(value: string | null) {
  confirmationDialog.open = false
  const resolve = resolveRequest
  resolveRequest = null
  resolve?.(value)
}
