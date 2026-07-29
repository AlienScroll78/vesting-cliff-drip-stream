import { useState, useRef, useId } from 'react'

interface TooltipProps {
  content: string
}

export function Tooltip({ content }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={btnRef}
        type="button"
        aria-describedby={id}
        aria-label="More information"
        onClick={() => setVisible(v => !v)}
        onBlur={() => setVisible(false)}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{
          background: 'none',
          border: '1px solid var(--accent)',
          borderRadius: '50%',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 700,
          lineHeight: 1,
          padding: '0 4px',
          marginLeft: '6px',
        }}
      >
        ℹ
      </button>
      {visible && (
        <span
          role="tooltip"
          id={id}
          style={{
            position: 'absolute',
            left: '110%',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--bg)',
            border: '1px solid var(--accent-border)',
            borderRadius: '6px',
            boxShadow: 'var(--shadow)',
            color: 'var(--text)',
            fontSize: '13px',
            lineHeight: '145%',
            maxWidth: '220px',
            padding: '8px 10px',
            pointerEvents: 'none',
            whiteSpace: 'normal',
            width: 'max-content',
            zIndex: 10,
          }}
        >
          {content}
        </span>
      )}
    </span>
  )
}
