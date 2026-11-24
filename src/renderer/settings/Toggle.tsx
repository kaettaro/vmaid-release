interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 読み上げ・説明用の名前(「○○を有効にする」など) */
  label: string
  disabled?: boolean
  title?: string
}

/**
 * ON/OFF のトグルスイッチ(丸が左右に動くタイプ)。チェックボックスの代わりに、「有効/無効」「ON/OFF」を切り替えるところに使う。
 * (複数を選ぶ「選択」のチェックボックスと、見た目で区別できるようにするため)
 */
export function Toggle({ checked, onChange, label, disabled, title }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title ?? (checked ? 'ON(クリックで OFF)' : 'OFF(クリックで ON)')}
      disabled={disabled}
      className={`toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  )
}
