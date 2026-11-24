import { useState } from 'react'

/**
 * 入力中はローカルの値を保持し、フォーカスを外したとき(または Enter)に保存する。
 * main から返ってきた値が変わったら(検証で丸められた場合など)入力欄も追従する。
 */
export function useCommitted(value: string, commit: (v: string) => void): {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onBlur: () => void
} {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  // main から返った値が変わったら入力欄も追従する(props から state を導出する React 推奨の書き方)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  return {
    value: draft,
    onChange: (e) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== value) commit(draft)
    }
  }
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function TextField({
  label,
  hint,
  value,
  placeholder,
  onCommit
}: {
  label: string
  hint?: React.ReactNode
  value: string
  placeholder?: string
  onCommit: (v: string) => void
}): React.JSX.Element {
  const bind = useCommitted(value, onCommit)
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        placeholder={placeholder}
        spellCheck={false}
        {...bind}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
        }}
      />
    </Field>
  )
}

export function TextAreaField({
  label,
  hint,
  value,
  rows = 5,
  onCommit
}: {
  label: string
  hint?: React.ReactNode
  value: string
  rows?: number
  onCommit: (v: string) => void
}): React.JSX.Element {
  const bind = useCommitted(value, onCommit)
  return (
    <Field label={label} hint={hint}>
      <textarea rows={rows} {...bind} />
    </Field>
  )
}
